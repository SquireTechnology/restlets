/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search'],
/**
 * @param {record} record
 * @param {search} search
 */
function(record, search) {

    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type
     * @Since 2015.2
     */
    function afterSubmit(scriptContext) {
        if(scriptContext.type == 'create' || scriptContext.type == 'edit'){
            
            var newRec = scriptContext.newRecord;
            var order = record.load({
                type: record.Type.SALES_ORDER,
                id: newRec.id,
                isDynamic: true
            });
            log.debug({ title: 'order id', details: order.id });

            var lineCount = order.getLineCount({ sublistId: 'item' });

            //Loop through lines
            for( var i = 0; i < lineCount; i++ ){

                var item = order.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });

                var itemType = order.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                log.debug({ title: 'item type', details: itemType });

                if( itemType == 'Discount' ){
                    var prevItem = order.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i-1 });
                    log.debug({ title: 'prev item', details: prevItem + order.getSublistValue('item', 'item_display', i-1) });
                    
                    order.selectLine({ sublistId: 'item', line: i });
                    order.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sku_sourced', value: prevItem, line: i });
                    order.commitLine({ sublistId: 'item', line: i });
                }else{
                    order.selectLine({ sublistId: 'item', line: i });
                    order.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sku_sourced', value: item, line: i });
                    order.commitLine({ sublistId: 'item', line: i });
                }
            }
            order.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
    
});
