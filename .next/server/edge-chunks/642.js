"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[642],{9156:e=>{var i=Object.defineProperty,t=Object.getOwnPropertyDescriptor,n=Object.getOwnPropertyNames,r=Object.prototype.hasOwnProperty,a={};((e,t)=>{for(var n in t)i(e,n,{get:t[n],enumerable:!0})})(a,{Analytics:()=>c}),e.exports=((e,a,s,l)=>{if(a&&"object"==typeof a||"function"==typeof a)for(let s of n(a))r.call(e,s)||void 0===s||i(e,s,{get:()=>a[s],enumerable:!(l=t(a,s))||l.enumerable});return e})(i({},"__esModule",{value:!0}),a);var s=`
local key = KEYS[1]
local field = ARGV[1]

local data = redis.call("ZRANGE", key, 0, -1, "WITHSCORES")
local count = {}

for i = 1, #data, 2 do
  local json_str = data[i]
  local score = tonumber(data[i + 1])
  local obj = cjson.decode(json_str)

  local fieldValue = obj[field]

  if count[fieldValue] == nil then
    count[fieldValue] = score
  else
    count[fieldValue] = count[fieldValue] + score
  end
end

local result = {}
for k, v in pairs(count) do
  table.insert(result, {k, v})
end

return result
`,l=`
local prefix = KEYS[1]
local first_timestamp = tonumber(ARGV[1]) -- First timestamp to check
local increment = tonumber(ARGV[2])       -- Increment between each timestamp
local num_timestamps = tonumber(ARGV[3])  -- Number of timestampts to check (24 for a day and 24 * 7 for a week)
local num_elements = tonumber(ARGV[4])    -- Number of elements to fetch in each category
local check_at_most = tonumber(ARGV[5])   -- Number of elements to check at most.

local keys = {}
for i = 1, num_timestamps do
  local timestamp = first_timestamp - (i - 1) * increment
  table.insert(keys, prefix .. ":" .. timestamp)
end

-- get the union of the groups
local zunion_params = {"ZUNION", num_timestamps, unpack(keys)}
table.insert(zunion_params, "WITHSCORES")
local result = redis.call(unpack(zunion_params))

-- select num_elements many items
local true_group = {}
local false_group = {}
local denied_group = {}
local true_count = 0
local false_count = 0
local denied_count = 0
local i = #result - 1

-- index to stop at after going through "checkAtMost" many items:
local cutoff_index = #result - 2 * check_at_most

-- iterate over the results
while (true_count + false_count + denied_count) < (num_elements * 3) and 1 <= i and i >= cutoff_index do
  local score = tonumber(result[i + 1])
  if score > 0 then
    local element = result[i]
    if string.find(element, "success\\":true") and true_count < num_elements then
      table.insert(true_group, {score, element})
      true_count = true_count + 1
    elseif string.find(element, "success\\":false") and false_count < num_elements then
      table.insert(false_group, {score, element})
      false_count = false_count + 1
    elseif string.find(element, "success\\":\\"denied") and denied_count < num_elements then
      table.insert(denied_group, {score, element})
      denied_count = denied_count + 1
    end
  end
  i = i - 2
end

return {true_group, false_group, denied_group}
`,o=`
local prefix = KEYS[1]
local first_timestamp = tonumber(ARGV[1])
local increment = tonumber(ARGV[2])
local num_timestamps = tonumber(ARGV[3])

local keys = {}
for i = 1, num_timestamps do
  local timestamp = first_timestamp - (i - 1) * increment
  table.insert(keys, prefix .. ":" .. timestamp)
end

-- get the union of the groups
local zunion_params = {"ZUNION", num_timestamps, unpack(keys)}
table.insert(zunion_params, "WITHSCORES")
local result = redis.call(unpack(zunion_params))

return result
`,c=class{redis;prefix;bucketSize;constructor(e){this.redis=e.redis,this.prefix=e.prefix??"@upstash/analytics",this.bucketSize=this.parseWindow(e.window)}validateTableName(e){if(!/^[a-zA-Z0-9_-]+$/.test(e))throw Error(`Invalid table name: ${e}. Table names can only contain letters, numbers, dashes and underscores.`)}parseWindow(e){if("number"==typeof e){if(e<=0)throw Error(`Invalid window: ${e}`);return e}let i=/^(\d+)([smhd])$/;if(!i.test(e))throw Error(`Invalid window: ${e}`);let[,t,n]=e.match(i),r=parseInt(t);switch(n){case"s":return 1e3*r;case"m":return 6e4*r;case"h":return 36e5*r;case"d":return 864e5*r;default:throw Error(`Invalid window unit: ${n}`)}}getBucket(e){return Math.floor((e??Date.now())/this.bucketSize)*this.bucketSize}async ingest(e,...i){this.validateTableName(e),await Promise.all(i.map(async i=>{let t=this.getBucket(i.time),n=[this.prefix,e,t].join(":");await this.redis.zincrby(n,1,JSON.stringify({...i,time:void 0}))}))}formatBucketAggregate(e,i,t){let n={};return e.forEach(([e,t])=>{"success"==i&&(e=1===e?"true":null===e?"false":e),n[i]=n[i]||{},n[i][(e??"null").toString()]=t}),{time:t,...n}}async aggregateBucket(e,i,t){this.validateTableName(e);let n=this.getBucket(t),r=[this.prefix,e,n].join(":"),a=await this.redis.eval(s,[r],[i]);return this.formatBucketAggregate(a,i,n)}async aggregateBuckets(e,i,t,n){this.validateTableName(e);let r=this.getBucket(n),a=[];for(let n=0;n<t;n+=1)a.push(this.aggregateBucket(e,i,r)),r-=this.bucketSize;return Promise.all(a)}async aggregateBucketsWithPipeline(e,i,t,n,r){this.validateTableName(e),r=r??48;let a=this.getBucket(n),l=[],o=this.redis.pipeline(),c=[];for(let n=1;n<=t;n+=1){let d=[this.prefix,e,a].join(":");o.eval(s,[d],[i]),l.push(a),a-=this.bucketSize,(n%r==0||n==t)&&(c.push(o.exec()),o=this.redis.pipeline())}return(await Promise.all(c)).flat().map((e,t)=>this.formatBucketAggregate(e,i,l[t]))}async getAllowedBlocked(e,i,t){this.validateTableName(e);let n=[this.prefix,e].join(":"),r=this.getBucket(t),a=await this.redis.eval(o,[n],[r,this.bucketSize,i]),s={};for(let e=0;e<a.length;e+=2){let i=a[e],t=i.identifier,n=+a[e+1];s[t]||(s[t]={success:0,blocked:0}),s[t][i.success?"success":"blocked"]=n}return s}async getMostAllowedBlocked(e,i,t,n,r){this.validateTableName(e);let a=[this.prefix,e].join(":"),s=this.getBucket(n),[o,c,d]=await this.redis.eval(l,[a],[s,this.bucketSize,i,t,r??5*t]);return{allowed:this.toDicts(o),ratelimited:this.toDicts(c),denied:this.toDicts(d)}}toDicts(e){let i=[];for(let t=0;t<e.length;t+=1){let n=+e[t][0],r=e[t][1];i.push({identifier:r.identifier,count:n})}return i}}},9642:(e,i,t)=>{var n=Object.defineProperty,r=Object.getOwnPropertyDescriptor,a=Object.getOwnPropertyNames,s=Object.prototype.hasOwnProperty,l=(e,i)=>{for(var t in i)n(e,t,{get:i[t],enumerable:!0})},o={};l(o,{Analytics:()=>d,IpDenyList:()=>L,MultiRegionRatelimit:()=>G,Ratelimit:()=>C}),e.exports=((e,i,t,l)=>{if(i&&"object"==typeof i||"function"==typeof i)for(let t of a(i))s.call(e,t)||void 0===t||n(e,t,{get:()=>i[t],enumerable:!(l=r(i,t))||l.enumerable});return e})(n({},"__esModule",{value:!0}),o);var c=t(9156),d=class{analytics;table="events";constructor(e){this.analytics=new c.Analytics({redis:e.redis,window:"1h",prefix:e.prefix??"@upstash/ratelimit",retention:"90d"})}extractGeo(e){return void 0!==e.geo?e.geo:void 0!==e.cf?e.cf:{}}async record(e){await this.analytics.ingest(this.table,e)}async series(e,i){let t=Math.min((this.analytics.getBucket(Date.now())-this.analytics.getBucket(i))/36e5,256);return this.analytics.aggregateBucketsWithPipeline(this.table,e,t)}async getUsage(e=0){let i=Math.min((this.analytics.getBucket(Date.now())-this.analytics.getBucket(e))/36e5,256);return await this.analytics.getAllowedBlocked(this.table,i)}async getUsageOverTime(e,i){return await this.analytics.aggregateBucketsWithPipeline(this.table,i,e)}async getMostAllowedBlocked(e,i,t){return i=i??5,this.analytics.getMostAllowedBlocked(this.table,e,i,void 0,t)}},u=class{cache;constructor(e){this.cache=e}isBlocked(e){if(!this.cache.has(e))return{blocked:!1,reset:0};let i=this.cache.get(e);return i<Date.now()?(this.cache.delete(e),{blocked:!1,reset:0}):{blocked:!0,reset:i}}blockUntil(e,i){this.cache.set(e,i)}set(e,i){this.cache.set(e,i)}get(e){return this.cache.get(e)||null}incr(e,i=1){let t=this.cache.get(e)??0;return t+=i,this.cache.set(e,t),t}pop(e){this.cache.delete(e)}empty(){this.cache.clear()}size(){return this.cache.size}},m=":dynamic:global",h="@upstash/ratelimit";function f(e){let i=e.match(/^(\d+)\s?(ms|s|m|h|d)$/);if(!i)throw Error(`Unable to parse window size: ${e}`);let t=Number.parseInt(i[1]);switch(i[2]){case"ms":return t;case"s":return 1e3*t;case"m":return 6e4*t;case"h":return 36e5*t;case"d":return 864e5*t;default:throw Error(`Unable to parse window size: ${e}`)}}var y=async(e,i,t,n)=>{try{return await e.redis.evalsha(i.hash,t,n)}catch(r){if(`${r}`.includes("NOSCRIPT"))return await e.redis.eval(i.script,t,n);throw r}},p={singleRegion:{fixedWindow:{limit:{script:`
  local key           = KEYS[1]
  local dynamicLimitKey = KEYS[2]  -- optional: key for dynamic limit in redis
  local tokens        = tonumber(ARGV[1])  -- default limit
  local window        = ARGV[2]
  local incrementBy   = ARGV[3] -- increment rate per request at a given value, default is 1

  -- Check for dynamic limit
  local effectiveLimit = tokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end

  local r = redis.call("INCRBY", key, incrementBy)
  if r == tonumber(incrementBy) then
  -- The first time this key is set, the value will be equal to incrementBy.
  -- So we only need the expire command once
  redis.call("PEXPIRE", key, window)
  end

  return {r, effectiveLimit}
`,hash:"472e55443b62f60d0991028456c57815a387066d"},getRemaining:{script:`
  local key = KEYS[1]
  local dynamicLimitKey = KEYS[2]  -- optional: key for dynamic limit in redis
  local tokens = tonumber(ARGV[1])  -- default limit

  -- Check for dynamic limit
  local effectiveLimit = tokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end

  local value = redis.call('GET', key)
  local usedTokens = 0
  if value then
    usedTokens = tonumber(value)
  end
  
  return {effectiveLimit - usedTokens, effectiveLimit}
`,hash:"40515c9dd0a08f8584f5f9b593935f6a87c1c1c3"}},slidingWindow:{limit:{script:`
  local currentKey  = KEYS[1]           -- identifier including prefixes
  local previousKey = KEYS[2]           -- key of the previous bucket
  local dynamicLimitKey = KEYS[3]       -- optional: key for dynamic limit in redis
  local tokens      = tonumber(ARGV[1]) -- default tokens per window
  local now         = ARGV[2]           -- current timestamp in milliseconds
  local window      = ARGV[3]           -- interval in milliseconds
  local incrementBy = tonumber(ARGV[4]) -- increment rate per request at a given value, default is 1

  -- Check for dynamic limit
  local effectiveLimit = tokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end

  local requestsInCurrentWindow = redis.call("GET", currentKey)
  if requestsInCurrentWindow == false then
    requestsInCurrentWindow = 0
  end

  local requestsInPreviousWindow = redis.call("GET", previousKey)
  if requestsInPreviousWindow == false then
    requestsInPreviousWindow = 0
  end
  local percentageInCurrent = ( now % window ) / window
  -- weighted requests to consider from the previous window
  requestsInPreviousWindow = math.floor(( 1 - percentageInCurrent ) * requestsInPreviousWindow)

  -- Only check limit if not refunding (negative rate)
  if incrementBy > 0 and requestsInPreviousWindow + requestsInCurrentWindow >= effectiveLimit then
    return {-1, effectiveLimit}
  end

  local newValue = redis.call("INCRBY", currentKey, incrementBy)
  if newValue == incrementBy then
    -- The first time this key is set, the value will be equal to incrementBy.
    -- So we only need the expire command once
    redis.call("PEXPIRE", currentKey, window * 2 + 1000) -- Enough time to overlap with a new window + 1 second
  end
  return {effectiveLimit - ( newValue + requestsInPreviousWindow ), effectiveLimit}
`,hash:"977fb636fb5ceb7e98a96d1b3a1272ba018efdae"},getRemaining:{script:`
  local currentKey  = KEYS[1]           -- identifier including prefixes
  local previousKey = KEYS[2]           -- key of the previous bucket
  local dynamicLimitKey = KEYS[3]       -- optional: key for dynamic limit in redis
  local tokens      = tonumber(ARGV[1]) -- default tokens per window
  local now         = ARGV[2]           -- current timestamp in milliseconds
  local window      = ARGV[3]           -- interval in milliseconds

  -- Check for dynamic limit
  local effectiveLimit = tokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end

  local requestsInCurrentWindow = redis.call("GET", currentKey)
  if requestsInCurrentWindow == false then
    requestsInCurrentWindow = 0
  end

  local requestsInPreviousWindow = redis.call("GET", previousKey)
  if requestsInPreviousWindow == false then
    requestsInPreviousWindow = 0
  end

  local percentageInCurrent = ( now % window ) / window
  -- weighted requests to consider from the previous window
  requestsInPreviousWindow = math.floor(( 1 - percentageInCurrent ) * requestsInPreviousWindow)

  local usedTokens = requestsInPreviousWindow + requestsInCurrentWindow
  return {effectiveLimit - usedTokens, effectiveLimit}
`,hash:"ee3a3265fad822f83acad23f8a1e2f5c0b156b03"}},tokenBucket:{limit:{script:`
  local key         = KEYS[1]           -- identifier including prefixes
  local dynamicLimitKey = KEYS[2]       -- optional: key for dynamic limit in redis
  local maxTokens   = tonumber(ARGV[1]) -- default maximum number of tokens
  local interval    = tonumber(ARGV[2]) -- size of the window in milliseconds
  local refillRate  = tonumber(ARGV[3]) -- how many tokens are refilled after each interval
  local now         = tonumber(ARGV[4]) -- current timestamp in milliseconds
  local incrementBy = tonumber(ARGV[5]) -- how many tokens to consume, default is 1

  -- Check for dynamic limit
  local effectiveLimit = maxTokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end
        
  local bucket = redis.call("HMGET", key, "refilledAt", "tokens")
        
  local refilledAt
  local tokens

  if bucket[1] == false then
    refilledAt = now
    tokens = effectiveLimit
  else
    refilledAt = tonumber(bucket[1])
    tokens = tonumber(bucket[2])
  end
        
  if now >= refilledAt + interval then
    local numRefills = math.floor((now - refilledAt) / interval)
    tokens = math.min(effectiveLimit, tokens + numRefills * refillRate)

    refilledAt = refilledAt + numRefills * interval
  end

  -- Only reject if tokens are 0 and we're consuming (not refunding)
  if tokens == 0 and incrementBy > 0 then
    return {-1, refilledAt + interval, effectiveLimit}
  end

  local remaining = tokens - incrementBy
  local expireAt = math.ceil(((effectiveLimit - remaining) / refillRate)) * interval
        
  redis.call("HSET", key, "refilledAt", refilledAt, "tokens", remaining)

  if (expireAt > 0) then
    redis.call("PEXPIRE", key, expireAt)
  end
  return {remaining, refilledAt + interval, effectiveLimit}
`,hash:"b35c5bc0b7fdae7dd0573d4529911cabaf9d1d89"},getRemaining:{script:`
  local key         = KEYS[1]
  local dynamicLimitKey = KEYS[2]       -- optional: key for dynamic limit in redis
  local maxTokens   = tonumber(ARGV[1]) -- default maximum number of tokens

  -- Check for dynamic limit
  local effectiveLimit = maxTokens
  if dynamicLimitKey ~= "" then
    local dynamicLimit = redis.call("GET", dynamicLimitKey)
    if dynamicLimit then
      effectiveLimit = tonumber(dynamicLimit)
    end
  end
        
  local bucket = redis.call("HMGET", key, "refilledAt", "tokens")

  if bucket[1] == false then
    return {effectiveLimit, -1, effectiveLimit}
  end
        
  return {tonumber(bucket[2]), tonumber(bucket[1]), effectiveLimit}
`,hash:"deb03663e8af5a968deee895dd081be553d2611b"}},cachedFixedWindow:{limit:{script:`
  local key     = KEYS[1]
  local window  = ARGV[1]
  local incrementBy   = ARGV[2] -- increment rate per request at a given value, default is 1

  local r = redis.call("INCRBY", key, incrementBy)
  if r == incrementBy then
  -- The first time this key is set, the value will be equal to incrementBy.
  -- So we only need the expire command once
  redis.call("PEXPIRE", key, window)
  end
      
  return r
`,hash:"c26b12703dd137939b9a69a3a9b18e906a2d940f"},getRemaining:{script:`
  local key = KEYS[1]
  local tokens = 0

  local value = redis.call('GET', key)
  if value then
      tokens = value
  end
  return tokens
`,hash:"8e8f222ccae68b595ee6e3f3bf2199629a62b91a"}}},multiRegion:{fixedWindow:{limit:{script:`
	local key           = KEYS[1]
	local id            = ARGV[1]
	local window        = ARGV[2]
	local incrementBy   = tonumber(ARGV[3])

	redis.call("HSET", key, id, incrementBy)
	local fields = redis.call("HGETALL", key)
	if #fields == 2 and tonumber(fields[2])==incrementBy then
	-- The first time this key is set, and the value will be equal to incrementBy.
	-- So we only need the expire command once
	  redis.call("PEXPIRE", key, window)
	end

	return fields
`,hash:"a8c14f3835aa87bd70e5e2116081b81664abcf5c"},getRemaining:{script:`
      local key = KEYS[1]
      local tokens = 0

      local fields = redis.call("HGETALL", key)

      return fields
    `,hash:"8ab8322d0ed5fe5ac8eb08f0c2e4557f1b4816fd"}},slidingWindow:{limit:{script:`
	local currentKey    = KEYS[1]           -- identifier including prefixes
	local previousKey   = KEYS[2]           -- key of the previous bucket
	local tokens        = tonumber(ARGV[1]) -- tokens per window
	local now           = ARGV[2]           -- current timestamp in milliseconds
	local window        = ARGV[3]           -- interval in milliseconds
	local requestId     = ARGV[4]           -- uuid for this request
	local incrementBy   = tonumber(ARGV[5]) -- custom rate, default is  1

	local currentFields = redis.call("HGETALL", currentKey)
	local requestsInCurrentWindow = 0
	for i = 2, #currentFields, 2 do
	requestsInCurrentWindow = requestsInCurrentWindow + tonumber(currentFields[i])
	end

	local previousFields = redis.call("HGETALL", previousKey)
	local requestsInPreviousWindow = 0
	for i = 2, #previousFields, 2 do
	requestsInPreviousWindow = requestsInPreviousWindow + tonumber(previousFields[i])
	end

	local percentageInCurrent = ( now % window) / window

	-- Only check limit if not refunding (negative rate)
	if incrementBy > 0 and requestsInPreviousWindow * (1 - percentageInCurrent ) + requestsInCurrentWindow + incrementBy > tokens then
	  return {currentFields, previousFields, false}
	end

	redis.call("HSET", currentKey, requestId, incrementBy)

	if requestsInCurrentWindow == 0 then 
	  -- The first time this key is set, the value will be equal to incrementBy.
	  -- So we only need the expire command once
	  redis.call("PEXPIRE", currentKey, window * 2 + 1000) -- Enough time to overlap with a new window + 1 second
	end
	return {currentFields, previousFields, true}
`,hash:"1e7ca8dcd2d600a6d0124a67a57ea225ed62921b"},getRemaining:{script:`
	local currentKey    = KEYS[1]           -- identifier including prefixes
	local previousKey   = KEYS[2]           -- key of the previous bucket
	local now         	= ARGV[1]           -- current timestamp in milliseconds
  	local window      	= ARGV[2]           -- interval in milliseconds

	local currentFields = redis.call("HGETALL", currentKey)
	local requestsInCurrentWindow = 0
	for i = 2, #currentFields, 2 do
	requestsInCurrentWindow = requestsInCurrentWindow + tonumber(currentFields[i])
	end

	local previousFields = redis.call("HGETALL", previousKey)
	local requestsInPreviousWindow = 0
	for i = 2, #previousFields, 2 do
	requestsInPreviousWindow = requestsInPreviousWindow + tonumber(previousFields[i])
	end

	local percentageInCurrent = ( now % window) / window
  	requestsInPreviousWindow = math.floor(( 1 - percentageInCurrent ) * requestsInPreviousWindow)
	
	return requestsInCurrentWindow + requestsInPreviousWindow
`,hash:"558c9306b7ec54abb50747fe0b17e5d44bd24868"}}}},w={script:`
      local pattern = KEYS[1]

      -- Initialize cursor to start from 0
      local cursor = "0"

      repeat
          -- Scan for keys matching the pattern
          local scan_result = redis.call('SCAN', cursor, 'MATCH', pattern)

          -- Extract cursor for the next iteration
          cursor = scan_result[1]

          -- Extract keys from the scan result
          local keys = scan_result[2]

          for i=1, #keys do
          redis.call('DEL', keys[i])
          end

      -- Continue scanning until cursor is 0 (end of keyspace)
      until cursor == "0"
    `,hash:"54bd274ddc59fb3be0f42deee2f64322a10e2b50"},g="denyList",b="ipDenyList",k="ipDenyListStatus",v=`
  -- Checks if values provideed in ARGV are present in the deny lists.
  -- This is done using the allDenyListsKey below.

  -- Additionally, checks the status of the ip deny list using the
  -- ipDenyListStatusKey below. Here are the possible states of the
  -- ipDenyListStatusKey key:
  -- * status == -1: set to "disabled" with no TTL
  -- * status == -2: not set, meaning that is was set before but expired
  -- * status  >  0: set to "valid", with a TTL
  --
  -- In the case of status == -2, we set the status to "pending" with
  -- 30 second ttl. During this time, the process which got status == -2
  -- will update the ip deny list.

  local allDenyListsKey     = KEYS[1]
  local ipDenyListStatusKey = KEYS[2]

  local results = redis.call('SMISMEMBER', allDenyListsKey, unpack(ARGV))
  local status  = redis.call('TTL', ipDenyListStatusKey)
  if status == -2 then
    redis.call('SETEX', ipDenyListStatusKey, 30, "pending")
  end

  return { results, status }
`,L={};l(L,{ThresholdError:()=>R,disableIpDenyList:()=>I,updateIpDenyList:()=>T});var x=e=>864e5-((e||Date.now())-72e5)%864e5,R=class extends Error{constructor(e){super(`Allowed threshold values are from 1 to 8, 1 and 8 included. Received: ${e}`),this.name="ThresholdError"}},E=async e=>{if("number"!=typeof e||e<1||e>8)throw new R(e);try{let i=await fetch(`https://raw.githubusercontent.com/stamparm/ipsum/master/levels/${e}.txt`);if(!i.ok)throw Error(`Error fetching data: ${i.statusText}`);return(await i.text()).split("\n").filter(e=>e.length>0)}catch(e){throw Error(`Failed to fetch ip deny list: ${e}`)}},T=async(e,i,t,n)=>{let r=await E(t),a=[i,g,"all"].join(":"),s=[i,g,b].join(":"),l=[i,k].join(":"),o=e.multi();return o.sdiffstore(a,a,s),o.del(s),o.sadd(s,r.at(0),...r.slice(1)),o.sdiffstore(s,s,a),o.sunionstore(a,a,s),o.set(l,"valid",{px:n??x()}),await o.exec()},I=async(e,i)=>{let t=[i,g,"all"].join(":"),n=[i,g,b].join(":"),r=[i,k].join(":"),a=e.multi();return a.sdiffstore(t,t,n),a.del(n),a.set(r,"disabled"),await a.exec()},A=new u(new Map),P=e=>e.find(e=>A.isBlocked(e).blocked),K=e=>{A.size()>1e3&&A.empty(),A.blockUntil(e,Date.now()+6e4)},W=async(e,i,t)=>{let n;let[r,a]=await e.eval(v,[[i,g,"all"].join(":"),[i,k].join(":")],t);return r.map((e,i)=>{e&&(K(t[i]),n=t[i])}),{deniedValue:n,invalidIpDenyList:-2===a}},B=(e,i,[t,n],r)=>{if(n.deniedValue&&(t.success=!1,t.remaining=0,t.reason="denyList",t.deniedValue=n.deniedValue),n.invalidIpDenyList){let n=T(e,i,r);t.pending=Promise.all([t.pending,n])}return t},q=e=>({success:!1,limit:0,remaining:0,reset:0,pending:Promise.resolve(),reason:"denyList",deniedValue:e}),S=class{limiter;ctx;prefix;timeout;primaryRedis;analytics;enableProtection;denyListThreshold;dynamicLimits;constructor(e){this.ctx=e.ctx,this.limiter=e.limiter,this.timeout=e.timeout??5e3,this.prefix=e.prefix??h,this.dynamicLimits=e.dynamicLimits??!1,this.enableProtection=e.enableProtection??!1,this.denyListThreshold=e.denyListThreshold??6,this.primaryRedis="redis"in this.ctx?this.ctx.redis:this.ctx.regionContexts[0].redis,"redis"in this.ctx&&(this.ctx.dynamicLimits=this.dynamicLimits,this.ctx.prefix=this.prefix),this.analytics=e.analytics?new d({redis:this.primaryRedis,prefix:this.prefix}):void 0,e.ephemeralCache instanceof Map?this.ctx.cache=new u(e.ephemeralCache):void 0===e.ephemeralCache&&(this.ctx.cache=new u(new Map))}limit=async(e,i)=>{let t=null;try{let n=this.getRatelimitResponse(e,i),{responseArray:r,newTimeoutId:a}=this.applyTimeout(n);t=a;let s=await Promise.race(r);return this.submitAnalytics(s,e,i)}finally{t&&clearTimeout(t)}};blockUntilReady=async(e,i)=>{let t;if(i<=0)throw Error("timeout must be positive");let n=Date.now()+i;for(;!(t=await this.limit(e)).success;){if(0===t.reset)throw Error("This should not happen");let e=Math.min(t.reset,n)-Date.now();if(await new Promise(i=>setTimeout(i,e)),Date.now()>n)break}return t};resetUsedTokens=async e=>{let i=[this.prefix,e].join(":");await this.limiter().resetTokens(this.ctx,i)};getRemaining=async e=>{let i=[this.prefix,e].join(":");return await this.limiter().getRemaining(this.ctx,i)};getRatelimitResponse=async(e,i)=>{let t=this.getKey(e),n=this.getDefinedMembers(e,i),r=P(n),a=r?[q(r),{deniedValue:r,invalidIpDenyList:!1}]:await Promise.all([this.limiter().limit(this.ctx,t,i?.rate),this.enableProtection?W(this.primaryRedis,this.prefix,n):{deniedValue:void 0,invalidIpDenyList:!1}]);return B(this.primaryRedis,this.prefix,a,this.denyListThreshold)};applyTimeout=e=>{let i=null,t=[e];if(this.timeout>0){let e=new Promise(e=>{i=setTimeout(()=>{e({success:!0,limit:0,remaining:0,reset:0,pending:Promise.resolve(),reason:"timeout"})},this.timeout)});t.push(e)}return{responseArray:t,newTimeoutId:i}};submitAnalytics=(e,i,t)=>{if(this.analytics)try{let n=t?this.analytics.extractGeo(t):void 0,r=this.analytics.record({identifier:"denyList"===e.reason?e.deniedValue:i,time:Date.now(),success:"denyList"===e.reason?"denied":e.success,...n}).catch(e=>{let i="Failed to record analytics";`${e}`.includes("WRONGTYPE")&&(i=`
    Failed to record analytics. See the information below:

    This can occur when you uprade to Ratelimit version 1.1.2
    or later from an earlier version.

    This occurs simply because the way we store analytics data
    has changed. To avoid getting this error, disable analytics
    for *an hour*, then simply enable it back.

    `),console.warn(i,e)});e.pending=Promise.all([e.pending,r])}catch(e){console.warn("Failed to record analytics",e)}return e};getKey=e=>[this.prefix,e].join(":");getDefinedMembers=(e,i)=>[e,i?.ip,i?.userAgent,i?.country].filter(Boolean);setDynamicLimit=async e=>{if(!this.dynamicLimits)throw Error("dynamicLimits must be enabled in the Ratelimit constructor to use setDynamicLimit()");let i=`${this.prefix}${m}`;await (!1===e.limit?this.primaryRedis.del(i):this.primaryRedis.set(i,e.limit))};getDynamicLimit=async()=>{if(!this.dynamicLimits)throw Error("dynamicLimits must be enabled in the Ratelimit constructor to use getDynamicLimit()");let e=`${this.prefix}${m}`,i=await this.primaryRedis.get(e);return{dynamicLimit:null===i?null:Number(i)}}};function _(){let e="",i="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",t=i.length;for(let n=0;n<16;n++)e+=i.charAt(Math.floor(Math.random()*t));return e}var G=class extends S{constructor(e){super({prefix:e.prefix,limiter:e.limiter,timeout:e.timeout,analytics:e.analytics,dynamicLimits:e.dynamicLimits,ctx:{regionContexts:e.redis.map(i=>({redis:i,prefix:e.prefix??h})),cache:e.ephemeralCache?new u(e.ephemeralCache):void 0}}),e.dynamicLimits&&console.warn("Warning: Dynamic limits are not yet supported for multi-region rate limiters. The dynamicLimits option will be ignored.")}static fixedWindow(e,i){let t=f(i);return()=>({async limit(i,n,r){let a=_(),s=Math.floor(Date.now()/t),l=[n,s].join(":"),o=r??1;if(i.cache&&o>0){let{blocked:t,reset:r}=i.cache.isBlocked(n);if(t)return{success:!1,limit:e,remaining:0,reset:r,pending:Promise.resolve(),reason:"cacheBlock"}}let c=i.regionContexts.map(e=>({redis:e.redis,request:y(e,p.multiRegion.fixedWindow.limit,[l],[a,t,o])})),d=e-(await Promise.any(c.map(e=>e.request))).reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0);async function u(){let i=[...new Set((await Promise.all(c.map(e=>e.request))).flat().reduce((e,i,t)=>(t%2==0&&e.push(i),e),[])).values()];for(let t of c){let n=(await t.request).reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0),r=(await t.request).reduce((e,i,t)=>(t%2==0&&e.push(i),e),[]);if(n>=e)continue;let a=i.filter(e=>!r.includes(e));if(0!==a.length)for(let e of a)await t.redis.hset(l,{[e]:o})}}let m=d>=0,h=(s+1)*t;return i.cache&&(m?o<0&&i.cache.pop(n):i.cache.blockUntil(n,h)),{success:m,limit:e,remaining:d,reset:h,pending:u()}},async getRemaining(i,n){let r=Math.floor(Date.now()/t),a=[n,r].join(":"),s=i.regionContexts.map(e=>({redis:e.redis,request:y(e,p.multiRegion.fixedWindow.getRemaining,[a],[null])}));return{remaining:Math.max(0,e-(await Promise.any(s.map(e=>e.request))).reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0)),reset:(r+1)*t,limit:e}},async resetTokens(e,i){let t=[i,"*"].join(":");e.cache&&e.cache.pop(i),await Promise.all(e.regionContexts.map(e=>{y(e,w,[t],[null])}))}})}static slidingWindow(e,i){let t=f(i),n=f(i);return()=>({async limit(i,r,a){let s=_(),l=Date.now(),o=Math.floor(l/t),c=[r,o].join(":"),d=[r,o-1].join(":"),u=a??1;if(i.cache&&u>0){let{blocked:t,reset:n}=i.cache.isBlocked(r);if(t)return{success:!1,limit:e,remaining:0,reset:n,pending:Promise.resolve(),reason:"cacheBlock"}}let m=i.regionContexts.map(i=>({redis:i.redis,request:y(i,p.multiRegion.slidingWindow.limit,[c,d],[e,l,n,s,u])})),h=l%n/n,[f,w,g]=await Promise.any(m.map(e=>e.request));g&&f.push(s,u.toString());let b=e-(Math.ceil(w.reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0)*(1-h))+f.reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0));async function k(){let i=[...new Set((await Promise.all(m.map(e=>e.request))).flatMap(([e])=>e).reduce((e,i,t)=>(t%2==0&&e.push(i),e),[])).values()];for(let t of m){let[n,r,a]=await t.request,s=n.reduce((e,i,t)=>(t%2==0&&e.push(i),e),[]);if(n.reduce((e,i,t)=>{let n=0;return t%2&&(n=Number.parseInt(i)),e+n},0)>=e)continue;let l=i.filter(e=>!s.includes(e));if(0!==l.length)for(let e of l)await t.redis.hset(c,{[e]:u})}}let v=(o+1)*n;return i.cache&&(g?u<0&&i.cache.pop(r):i.cache.blockUntil(r,v)),{success:!!g,limit:e,remaining:Math.max(0,b),reset:v,pending:k()}},async getRemaining(i,n){let r=Date.now(),a=Math.floor(r/t),s=[n,a].join(":"),l=[n,a-1].join(":"),o=i.regionContexts.map(e=>({redis:e.redis,request:y(e,p.multiRegion.slidingWindow.getRemaining,[s,l],[r,t])}));return{remaining:Math.max(0,e-await Promise.any(o.map(e=>e.request))),reset:(a+1)*t,limit:e}},async resetTokens(e,i){let t=[i,"*"].join(":");e.cache&&e.cache.pop(i),await Promise.all(e.regionContexts.map(e=>{y(e,w,[t],[null])}))}})}},C=class extends S{constructor(e){super({prefix:e.prefix,limiter:e.limiter,timeout:e.timeout,analytics:e.analytics,ctx:{redis:e.redis,prefix:e.prefix??h},ephemeralCache:e.ephemeralCache,enableProtection:e.enableProtection,denyListThreshold:e.denyListThreshold,dynamicLimits:e.dynamicLimits})}static fixedWindow(e,i){let t=f(i);return()=>({async limit(i,n,r){let a=Math.floor(Date.now()/t),s=[n,a].join(":"),l=r??1;if(i.cache&&l>0){let{blocked:t,reset:r}=i.cache.isBlocked(n);if(t)return{success:!1,limit:e,remaining:0,reset:r,pending:Promise.resolve(),reason:"cacheBlock"}}let o=i.dynamicLimits?`${i.prefix}${m}`:"",[c,d]=await y(i,p.singleRegion.fixedWindow.limit,[s,o],[e,t,l]),u=c<=d,h=(a+1)*t;return i.cache&&(u?l<0&&i.cache.pop(n):i.cache.blockUntil(n,h)),{success:u,limit:d,remaining:Math.max(0,d-c),reset:h,pending:Promise.resolve()}},async getRemaining(i,n){let r=Math.floor(Date.now()/t),a=[n,r].join(":"),s=i.dynamicLimits?`${i.prefix}${m}`:"",[l,o]=await y(i,p.singleRegion.fixedWindow.getRemaining,[a,s],[e]);return{remaining:Math.max(0,l),reset:(r+1)*t,limit:o}},async resetTokens(e,i){let t=[i,"*"].join(":");e.cache&&e.cache.pop(i),await y(e,w,[t],[null])}})}static slidingWindow(e,i){let t=f(i);return()=>({async limit(i,n,r){let a=Date.now(),s=Math.floor(a/t),l=[n,s].join(":"),o=[n,s-1].join(":"),c=r??1;if(i.cache&&c>0){let{blocked:t,reset:r}=i.cache.isBlocked(n);if(t)return{success:!1,limit:e,remaining:0,reset:r,pending:Promise.resolve(),reason:"cacheBlock"}}let d=i.dynamicLimits?`${i.prefix}${m}`:"",[u,h]=await y(i,p.singleRegion.slidingWindow.limit,[l,o,d],[e,a,t,c]),f=u>=0,w=(s+1)*t;return i.cache&&(f?c<0&&i.cache.pop(n):i.cache.blockUntil(n,w)),{success:f,limit:h,remaining:Math.max(0,u),reset:w,pending:Promise.resolve()}},async getRemaining(i,n){let r=Date.now(),a=Math.floor(r/t),s=[n,a].join(":"),l=[n,a-1].join(":"),o=i.dynamicLimits?`${i.prefix}${m}`:"",[c,d]=await y(i,p.singleRegion.slidingWindow.getRemaining,[s,l,o],[e,r,t]);return{remaining:Math.max(0,c),reset:(a+1)*t,limit:d}},async resetTokens(e,i){let t=[i,"*"].join(":");e.cache&&e.cache.pop(i),await y(e,w,[t],[null])}})}static tokenBucket(e,i,t){let n=f(i);return()=>({async limit(i,r,a){let s=Date.now(),l=a??1;if(i.cache&&l>0){let{blocked:e,reset:n}=i.cache.isBlocked(r);if(e)return{success:!1,limit:t,remaining:0,reset:n,pending:Promise.resolve(),reason:"cacheBlock"}}let o=i.dynamicLimits?`${i.prefix}${m}`:"",[c,d,u]=await y(i,p.singleRegion.tokenBucket.limit,[r,o],[t,n,e,s,l]),h=c>=0;return i.cache&&(h?l<0&&i.cache.pop(r):i.cache.blockUntil(r,d)),{success:h,limit:u,remaining:Math.max(0,c),reset:d,pending:Promise.resolve()}},async getRemaining(e,i){let r=e.dynamicLimits?`${e.prefix}${m}`:"",[a,s,l]=await y(e,p.singleRegion.tokenBucket.getRemaining,[i,r],[t]),o=Date.now()+n,c=s+n;return{remaining:Math.max(0,a),reset:-1===s?o:c,limit:l}},async resetTokens(e,i){e.cache&&e.cache.pop(i),await y(e,w,[i],[null])}})}static cachedFixedWindow(e,i){let t=f(i);return()=>({async limit(i,n,r){if(!i.cache)throw Error("This algorithm requires a cache");i.dynamicLimits&&console.warn("Warning: Dynamic limits are not yet supported for cachedFixedWindow algorithm. The dynamicLimits option will be ignored.");let a=Math.floor(Date.now()/t),s=[n,a].join(":"),l=(a+1)*t,o=r??1;if("number"==typeof i.cache.get(s)){let n=i.cache.incr(s,o),r=n<e,a=r?y(i,p.singleRegion.cachedFixedWindow.limit,[s],[t,o]):Promise.resolve();return{success:r,limit:e,remaining:e-n,reset:l,pending:a}}let c=await y(i,p.singleRegion.cachedFixedWindow.limit,[s],[t,o]);i.cache.set(s,c);let d=e-c;return{success:d>=0,limit:e,remaining:d,reset:l,pending:Promise.resolve()}},async getRemaining(i,n){if(!i.cache)throw Error("This algorithm requires a cache");let r=Math.floor(Date.now()/t),a=[n,r].join(":");return"number"==typeof i.cache.get(a)?{remaining:Math.max(0,e-(i.cache.get(a)??0)),reset:(r+1)*t,limit:e}:{remaining:Math.max(0,e-await y(i,p.singleRegion.cachedFixedWindow.getRemaining,[a],[null])),reset:(r+1)*t,limit:e}},async resetTokens(e,i){if(!e.cache)throw Error("This algorithm requires a cache");let n=[i,Math.floor(Date.now()/t)].join(":");e.cache.pop(n);let r=[i,"*"].join(":");await y(e,w,[r],[null])}})}}}}]);
//# sourceMappingURL=642.js.map