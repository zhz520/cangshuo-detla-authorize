import test from 'node:test'
import assert from 'node:assert/strict'
import {effectScope,ref} from 'vue'
import {useRecords} from '../src/records.js'

test('large lists render a bounded page, retain per-menu filters and clamp after refresh or deletion',()=>{
  const scope=effectScope(),page=ref('customers'),source=ref(Array.from({length:10000},(_,id)=>({id,name:'客户'+id,domains:['authorized.example']})))
  try{scope.run(()=>{
    const records=useRecords(()=>source.value,()=>page.value)
    assert.equal(records.rows.value.length,25);assert.equal(records.total.value,10000)
    records.state.value.page=400;assert.equal(records.rows.value[24].id,9999)
    records.query.value='客户9999';assert.equal(records.state.value.page,1);assert.equal(records.total.value,1)
    records.query.value='authorized.example';assert.equal(records.total.value,10000);records.query.value='客户9999'
    page.value='orders';assert.equal(records.query.value,'');assert.equal(records.rows.value.length,25)
    page.value='customers';assert.equal(records.query.value,'客户9999')
    records.query.value='';records.state.value.page=400;source.value=source.value.slice(0,2)
    assert.equal(records.state.value.page,1);assert.equal(records.rows.value.length,2)
  })}finally{scope.stop()}
})
