(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[715],{2067:e=>{"use strict";e.exports=require("node:async_hooks")},6195:e=>{"use strict";e.exports=require("node:buffer")},3611:(e,t,r)=>{"use strict";r.r(t),r.d(t,{default:()=>u}),r(3078);var a=r(8084),n=r(3277),i=r(9278),s=r(3410),d=r(9098),o=r(2210);function c(e,t=200){return new Response(JSON.stringify(e),{status:t,headers:{"Content-Type":"application/json"}})}async function l(e){let t=(0,s.a)(),r=await (0,d.n5)(e),a=new URL(e.url).pathname.split("/").pop(),[n]=await t`
    select id, user_id, tool, model, title, pinned, archived, created_at, updated_at
    from threads where id = ${a}
  `;if(!n||n.user_id!==r)return c({error:"Thread not found"},404);if("GET"===e.method){let e=await (0,o.TC)(a);if(e)return c({thread:n,messages:e,cached:!0});let r=await t`
      select id, role, content, attachments, job_id, created_at
      from messages where thread_id = ${a}
      order by created_at asc
    `;return await (0,o.zI)(a,r),c({thread:n,messages:r,cached:!1})}if("PATCH"===e.method){let r;try{r=await e.json()}catch{return c({error:"Invalid JSON body"},400)}let{title:n,pinned:i,archived:s}=r||{};return c({thread:(await t`
      update threads set
        title = coalesce(${n}, title),
        pinned = coalesce(${i}, pinned),
        archived = coalesce(${s}, archived)
      where id = ${a}
      returning id, tool, model, title, pinned, archived, created_at, updated_at
    `)[0]})}return"DELETE"===e.method?(await t`delete from threads where id = ${a}`,await (0,o.oG)(a),c({ok:!0})):c({error:"Method not allowed"},405)}function u(e){return(0,a.C)({...e,IncrementalCache:n.k,page:"/api/threads/[id]",handler:(0,i.fd)("/api/threads/[id]",l)})}},9098:(e,t,r)=>{"use strict";async function a(e){return"sanjay"}async function n(e,t){await e`
    insert into users (id, plan)
    values (${t}, 'free')
    on conflict (id) do nothing
  `}r.d(t,{n5:()=>a,oY:()=>n})},2210:(e,t,r)=>{"use strict";r.d(t,{P3:()=>c,TC:()=>d,oG:()=>o,zI:()=>s});var a=r(6793);let n=null;function i(){if(n)return n;let e=process.env.UPSTASH_REDIS_REST_URL,t=process.env.UPSTASH_REDIS_REST_TOKEN;return e&&t?n=new a.so({url:e,token:t}):null}async function s(e,t){let r=i();r&&await r.set(`thread:${e}:messages`,JSON.stringify(t),{ex:600})}async function d(e){let t=i();if(!t)return null;let r=await t.get(`thread:${e}:messages`);if(!r)return null;try{return"string"==typeof r?JSON.parse(r):r}catch{return null}}async function o(e){let t=i();t&&await t.del(`thread:${e}:messages`)}async function c(e,t){let r=i();r&&await r.set(`job:${e}`,JSON.stringify(t),{ex:30})}},3410:(e,t,r)=>{"use strict";r.d(t,{a:()=>i});var a=r(887);let n=null;function i(){if(n)return n;let e=process.env.DATABASE_URL;if(!e)throw Error("DATABASE_URL environment variable is not set");return n=(0,a.qn)(e)}}},e=>{var t=t=>e(e.s=t);e.O(0,[888,887,793],()=>t(3611));var r=e.O();(_ENTRIES="undefined"==typeof _ENTRIES?{}:_ENTRIES)["middleware_pages/api/threads/[id]"]=r}]);
//# sourceMappingURL=[id].js.map