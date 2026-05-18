/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
    
    function post(context) {
        try {
            const { action, data } = context;
            
            switch (action) {
                case 'create':
                    return createCreditMemo(data);
                case 'update':
                    return updateCreditMemo(data);
                case 'search':
                    return searchCreditMemos(data);
                default:
                    return {
                        status: 'error',
                        success: false,
                        message: 'Invalid action specified'
                    };
            }
        } catch (error) {
            log.error('RESTlet Error', error);
            return {
                status: 'error',
                success: false,
                message: error.message
            };
        }
    }
    
    function createCreditMemo(data) {
        try {
            const creditMemoRec = record.create({
                type: record.Type.CREDIT_MEMO
            });
            
            // Set required fields
            if (data.customer) creditMemoRec.setValue('entity', data.customer);
            if (data.memo) creditMemoRec.setValue('memo', data.memo);
            
            // Add line items if provided
            if (data.items && data.items.length > 0) {
                data.items.forEach((item, index) => {
                    creditMemoRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: index,
                        value: item.item
                    });
                    creditMemoRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: index,
                        value: item.quantity || 1
                    });
                    creditMemoRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        line: index,
                        value: item.rate
                    });
                });
            }
            
            const creditMemoId = creditMemoRec.save();
            
            log.debug('Credit Memo Created', `ID: ${creditMemoId}`);
            
            return {
                status: 'success',
                success: true,
                data: {
                    id: creditMemoId,
                    message: 'Credit memo created successfully'
                }
            };
        } catch (error) {
            log.error('Create Credit Memo Error', error);
            throw error;
        }
    }
    
    function updateCreditMemo(data) {
        try {
            if (!data.id) {
                throw new Error('Credit memo ID is required for updates');
            }
            
            const creditMemoRec = record.load({
                type: record.Type.CREDIT_MEMO,
                id: data.id
            });
            
            // Update fields as needed
            if (data.memo) creditMemoRec.setValue('memo', data.memo);
            if (data.status) creditMemoRec.setValue('status', data.status);
            
            const updatedId = creditMemoRec.save();
            
            log.debug('Credit Memo Updated', `ID: ${updatedId}`);
            
            return {
                status: 'success',
                success: true,
                data: {
                    id: updatedId,
                    message: 'Credit memo updated successfully'
                }
            };
        } catch (error) {
            log.error('Update Credit Memo Error', error);
            throw error;
        }
    }
    
    function searchCreditMemos(criteria) {
        try {
            const filters = [];
            
            if (criteria.customer) {
                filters.push(['entity', 'anyof', criteria.customer]);
            }
            if (criteria.dateFrom) {
                filters.push(['trandate', 'onorafter', criteria.dateFrom]);
            }
            if (criteria.dateTo) {
                filters.push(['trandate', 'onorbefore', criteria.dateTo]);
            }
            
            const creditMemoSearch = search.create({
                type: search.Type.CREDIT_MEMO,
                filters: filters,
                columns: [
                    'tranid',
                    'entity',
                    'trandate',
                    'status',
                    'total',
                    'memo'
                ]
            });
            
            const results = [];
            creditMemoSearch.run().each((result) => {
                results.push({
                    id: result.id,
                    tranid: result.getValue('tranid'),
                    customer: result.getText('entity'),
                    date: result.getValue('trandate'),
                    status: result.getText('status'),
                    total: result.getValue('total'),
                    memo: result.getValue('memo')
                });
                return true;
            });
            
            log.debug('Credit Memos Found', `Count: ${results.length}`);
            
            return {
                status: 'success',
                success: true,
                data: results
            };
        } catch (error) {
            log.error('Search Credit Memos Error', error);
            throw error;
        }
    }
    
    return {
        post: post
    };
});
