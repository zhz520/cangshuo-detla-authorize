// AbortSignal.timeout is unavailable in older iOS and embedded WeChat/QQ browsers.
export async function fetchWithTimeout(url,options={},milliseconds=35000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),milliseconds)
 try{return await fetch(url,{...options,signal:controller.signal})}finally{clearTimeout(timer)}
}
