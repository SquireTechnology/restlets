/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/https', 'N/record', 'N/search', 'N/log', 'N/error'],
    (https, record, search, log, error) => {
        /**
         * Handles the POST request for creating a customer payment.
         * @param {Object} requestBody - The request payload containing payment details.
         * @returns {Object} - The response object with success status and payment ID.
         */
        const post = (requestBody) => {
            log.debug('requestBody', requestBody);

            if(requestBody.id) {
                try{
                    let pmt = record.load({
                        type: record.Type.CUSTOMER_PAYMENT,
                        id: requestBody.id,
                        isDynamic: true     
                    });
    
                    pmt.setValue('custbody_pc_tran_stripe_id', requestBody.stripe_id);
    
                    const updatedPaymentId = pmt.save({
                        enableSourcing: true,
                        ignoreMandatoryFields: true
                    });
    
                    return {
                        status: '200',
                        success: true,
                        paymentId: updatedPaymentId
                    };

                }catch (e) {
                    return {
                        status: '400',
                        success: false,
                        message: e.message
                    };
                }

            } else {
                try {
                    // Step 1: Find the customer using the custom field 'custentity_pc_cus_customer_id'
                    const customerId = findCustomerByCustomId(requestBody.customer);
                    if (!customerId) {
                        throw error.create({
                            name: 'Customer Not Found',
                            message: `Customer with ID '${requestBody.customer}' not found`
                        });
                    }

                    // Step 2: Create the customer payment record
                    const rec = record.create({
                        type: record.Type.CUSTOMER_PAYMENT,
                        isDynamic: true
                    });

                    // Set the customer on the payment using the internal ID found
                    rec.setValue('customer', customerId);
                    rec.setValue('trandate', formatDate(requestBody.date));
                    rec.setValue('memo', requestBody.memo);
                    rec.setValue('custbody_pc_tran_stripe_id', requestBody.stripe_id);
                    rec.setValue('paymentmethod', requestBody.payment_method);
                    rec.setValue('payment', requestBody.total_payment_amount);

                    // Step 3: Apply payments to invoices
                    requestBody.invoices.forEach((inv) => {
                        const index = rec.findSublistLineWithValue('apply', 'doc', inv.invoice_id);
                        if (index > -1) {
                            rec.selectLine('apply', index);
                            rec.setCurrentSublistValue('apply', 'apply', true);
                            rec.setCurrentSublistValue('apply', 'amount', inv.payment_amount);
                            rec.commitLine('apply');
                        }
                    });

                    // Save the payment record
                    const paymentId = rec.save({
                        enableSourcing: true,
                        ignoreMandatoryFields: true
                    });

                    return {
                        status: '200',
                        success: true,
                        paymentId: paymentId
                    };

                } catch (e) {
                    return {
                        status: '400',
                        success: false,
                        message: e.message
                    };
                }

            }        
        };

        /**
         * Function to find the customer using the custom field 'custentity_pc_cus_customer_id'.
         * @param {string} customerCustomId - The custom field value to search for.
         * @returns {string|null} - The internal ID of the customer or null if not found.
         */
        const findCustomerByCustomId = (customerCustomId) => {
            const customerSearch = search.create({
                type: search.Type.CUSTOMER,
                filters: [
                    ['custentity_pc_cus_customer_id', 'is', customerCustomId]
                ],
                columns: ['internalid']
            });

            const results = customerSearch.run().getRange({ start: 0, end: 1 });
            return results.length > 0 ? results[0].getValue('internalid') : null;
        };

        /**
         * Function to format the date to the correct timezone.
         * @param {string} date - The date to format.
         * @returns {Date} - The formatted date.
         */
        const formatDate = (date) => {
            const utcDate = new Date(date);
            const timezoneOffset = utcDate.getTimezoneOffset() * 60000;
            return new Date(utcDate.getTime() + timezoneOffset);
        };

        return { post };
    });
