/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/search", "N/error", "N/encode", "N/url", "N/runtime"],
(record, search, error, encode, url, runtime) => {

  // Determines the max amount of records that will be returned regardless of what the response body limit says
  const MAX_RESULTS = 50; // hard cap; adjust as needed

  const post = (body) => {
    try {
      // Decide branch by presence of orderId vs customerId
      requireOneOf(body, ["orderId", "customerId"], "POST");

      // ----------------------
      // Branch A: orderId (single invoice) → return ONLY externalPdfLink
      // ----------------------
      if (!isEmpty(body.orderId)) {
        const orderId = String(body.orderId).trim();
        const inv = findInvoiceByOrderId(orderId);
        if (!inv) {
          throw error.create({ name: "NOT_FOUND", message: `No invoice found for orderId: ${orderId}` });
        }

        return {
          externalPdfLink: externalPdfLink(inv.id)
        };
      }

      // ----------------------
      // Branch B: customerId + (startDate OR cursor) (+ optional limit)
      // ----------------------
      requireKeys(body, ["customerId"], "POST");
      if (isEmpty(body.startDate) && isEmpty(body.cursor)) {
        throw error.create({ name: "MISSING_REQ_ARG", message: "Provide startDate (MM/DD/YYYY) or cursor" });
      }

      const customerId = String(body.customerId).trim();

      // Parse optional cursor; if present we ignore startDate for filtering
      const cursorStr = body.cursor && String(body.cursor).trim();
      const cursor = cursorStr ? decodeCursor(cursorStr) : null;

      const startDate = cursor ? cursor.lastDate : normalizeDateMMDDYYYY(String(body.startDate || "").trim());

      // Limit: default MAX_RESULTS; cap at MAX_RESULTS even if higher requested
      const requested = isEmpty(body.limit) ? MAX_RESULTS : parseInt(body.limit, 10);
      const effectiveLimit = isNaN(requested) ? MAX_RESULTS : Math.max(1, Math.min(requested, MAX_RESULTS));

      // Build search (parent + immediate children); ascending by date, then internalid
      const filters = buildFiltersForBatch(customerId, startDate, cursor);
      const s = search.create({
        type: "transaction",
        filters,
        columns: [
          search.createColumn({ name: "trandate", sort: search.Sort.ASC }),
          search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
          "tranid",
          "entity",
          "amount",
          "status"
        ]
      });

      // Fetch up to effectiveLimit rows
      const rows = getInvoices(s, effectiveLimit);

      // Compute hasMore before loading records (indicates more likely exist)
      const hasMore = rows.length === effectiveLimit;

      // Build response invoices (basic info + items), no PDFs
      const invoices = [];
      for (let i = 0; i < rows.length; i++) {
        // governance guard
        const remaining = runtime.getCurrentScript().getRemainingUsage();
        if (remaining < 100) break;

        const r = rows[i];
        const internalId = r.id;
        const tranDate = r.getValue("trandate"); // MM/DD/YYYY (UI format typical)

        invoices.push({
          id: Number(internalId),
          orderId: r.getValue("tranid"),
          tranDate: tranDate,
          entityName: r.getText("entity"),
          entityId: r.getValue("entity"),
          totalAmount: r.getValue("amount"),
          status: r.getText("status"),
          items: readInvoiceItems(internalId)
        });
      }

      // Next cursor: resume after the *last included invoice* (not just last row), to avoid gaps on governance stops
      let nextCursor = null;
      if (hasMore && invoices.length) {
        const lastIncluded = invoices[invoices.length - 1];
        nextCursor = encodeCursor({
          lastDate: lastIncluded.tranDate,
          lastInternalId: String(lastIncluded.id)
        });
      }

      // lastTimeStamp = tranDate of the last included invoice
      const lastTimeStamp = invoices.length ? invoices[invoices.length - 1].tranDate : null;

      return {
        customerId: Number(customerId),
        startDate: startDate,        //  the effective start date used
        limitApplied: effectiveLimit, // server-enforced cap for this call
        count: invoices.length,       // how many were actually returned
        hasMore,
        nextCursor,                   // base64 token or null
        lastTimeStamp,
        invoices
      };

    } catch (e) {
      log.error(e.name || "RESTLET_ERROR", `${e.message} ; Stack: ${e.stack}`);
      return { error: true, name: e.name || "RESTLET_ERROR", message: e.message || String(e) };
    }
  };

  // ============================
  // Helper functions
  // ============================
  const isEmpty = (v) =>
    v === "" || v === null || v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && Object.keys(v).length === 0);

  const requireOneOf = (body, keys, methodName) => {
    const present = keys.some(k => !isEmpty(body[k]));
    if (!present) {
      throw error.create({
        name: "MISSING_REQ_ARG",
        message: `Missing required argument. Provide one of: ${keys.join(", ")} for ${methodName}`
      });
    }
  };

  const requireKeys = (body, keys, methodName) => {
    for (const k of keys) {
      if (isEmpty(body[k]) && body[k] !== 0) {
        throw error.create({ name: "MISSING_REQ_ARG", message: `Missing required argument: [${k}] for ${methodName}` });
      }
    }
  };

  // Accept MM/DD/YYYY (as shown in NetSuite UI). Keep string as-is for search.
  const normalizeDateMMDDYYYY = (s) => {
    if (!s || typeof s !== "string") return s;
    return s.trim();
  };

  // Cursor helpers (base64 JSON via N/encode)
  const encodeCursor = (obj) =>
    encode.convert({ string: JSON.stringify(obj), inputEncoding: encode.Encoding.UTF_8, outputEncoding: encode.Encoding.BASE_64 });

  const decodeCursor = (b64) =>
    JSON.parse(encode.convert({ string: b64, inputEncoding: encode.Encoding.BASE_64, outputEncoding: encode.Encoding.UTF_8 }));

  // Build external link to Suitelet (only needs id)
  const externalPdfLink = (internalId) =>
    url.resolveScript({
      scriptId: "customscript_st_sl_generate_pdf_link",
      deploymentId: "customdeploy_st_sl_generate_pdf_link",
      returnExternalUrl: true,
      params: { id: internalId },
    });

  // Find an invoice by document number (orderId), ensure it's an Invoice
  const findInvoiceByOrderId = (orderId) => {
    const s = search.create({
      type: "transaction",
      filters: [
        ["mainline", "is", "T"], "AND",
        ["numbertext", "is", String(orderId)], "AND",
        ["type", "anyof", "CustInvc"]
      ],
      columns: ["tranid"]
    });
    const row = s.run().getRange({ start: 0, end: 1 })?.[0];
    if (!row) return null;
    return { id: row.id, orderId: row.getValue("tranid") };
  };

  // Transaction filters for batch: parent + immediate children, with start or cursor
  const buildFiltersForBatch = (customerId, startDate, cursor) => {
    const base = [
      ["mainline","is","T"], "AND",
      ["type","anyof","CustInvc"], "AND",
      [
        ["entity","anyof", String(customerId)], "OR",
        ["customer.parent","anyof", String(customerId)]
      ], "AND"
    ];

    if (!cursor) {
      // First page: date >= startDate
      base.push(["trandate","onorafter", startDate]);
    } else {
      // Resume strictly AFTER the last row: (date > lastDate) OR (date = lastDate AND internalid > lastInternalId)
      base.push([
        [["trandate","after", cursor.lastDate]], "OR",
        [["trandate","on", cursor.lastDate], "AND", ["internalidnumber","greaterthan", String(cursor.lastInternalId)]]
      ]);
    }

    return base;
  };

  // Run a search and take the first N rows in sort order
  const getInvoices = (srch, n) => {
    const page = srch.runPaged({ pageSize: Math.min(n, 1000) });
    const out = [];
    outer:
    for (let p = 0; p < page.pageRanges.length; p++) {
      const pg = page.fetch({ index: p });
      for (let i = 0; i < pg.data.length; i++) {
        out.push(pg.data[i]);
        if (out.length >= n) break outer;
      }
    }
    return out;
  };

  // Load line items for an invoice (needed in batch response)
  const readInvoiceItems = (internalId) => {
    const rec = record.load({ type: record.Type.INVOICE, id: internalId, isDynamic: false });
    const items = [];
    const count = rec.getLineCount({ sublistId: "item" }) || 0;
    for (let i = 0; i < count; i++) {
      items.push({
        itemId: rec.getSublistValue({ sublistId: "item", fieldId: "item", line: i }),
        itemText: rec.getSublistText({ sublistId: "item", fieldId: "item", line: i }),
        quantity: rec.getSublistValue({ sublistId: "item", fieldId: "quantity", line: i }),
        rate: rec.getSublistValue({ sublistId: "item", fieldId: "rate", line: i }),
        amount: rec.getSublistValue({ sublistId: "item", fieldId: "amount", line: i })
      });
    }
    return items;
  };

  return { post };
});
