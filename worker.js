const REQUEST_PATH = '/dyndns/update'

const PRESHARED_AUTH_PARAM_KEY = 'code'
const PRESHARED_AUTH_PARAM_VALUE = PRESHARED_SECRET // https://passwordsgenerator.net/
const MY_IP_PARAM = 'myip'
const HOSTNAME_PARAM = 'hostname'

const BASE_API = 'https://api.cloudflare.com/client/v4/'

const API_REQUEST = {
  headers: {
    'Content-Type': 'application/json;charset=UTF-8',
    'Authorization': `Bearer ${API_TOKEN}`,
  },
}

addEventListener('fetch', event => {
  event.respondWith(handleEvent(event))
})

async function handleEvent(event) {
  try {
    return await handleRequest(event.request)
  } catch (e) {
    return new Response(e.message || 'An error occurred!', { status: e.statusCode || 500 })
  }
}

async function handleRequest(request) {
  let requestURL = new URL(request.url)

  if (requestURL.pathname !== REQUEST_PATH) {
    throw new Error('Unknown request path', {statusCode: 404})
  }

  if (!authorizeRequest(requestURL)) {
    throw new Error('Invalid auth code', {statusCode: 403})
  }

  const clientIP = request.headers.get('CF-Connecting-IP')

  await handleDNSUpdate(requestURL, clientIP)

  return new Response('OK', {status: 200})
}

/**
 * Checks if the request contains a valid secret code parameter
 * @param {*} url 
 */
function authorizeRequest(url) {
  return url.searchParams.has(PRESHARED_AUTH_PARAM_KEY)
    && url.searchParams.get(PRESHARED_AUTH_PARAM_KEY) === PRESHARED_AUTH_PARAM_VALUE
}


async function handleDNSUpdate(url, clientIP) {
  if (!url.searchParams.has(HOSTNAME_PARAM)) {
    throw new Error('Missing required hostname param');
  }

  if (!url.searchParams.has(MY_IP_PARAM) && !clientIP) {
    throw new Error('Could not determine the IP address to set. You can pass the desired IP via the myip param.');
  }

  const ip = url.searchParams.has(MY_IP_PARAM) ? url.searchParams.get(MY_IP_PARAM) : clientIP
  const hostname = url.searchParams.get(HOSTNAME_PARAM)

  if (!/^(([1-9]?\d|1\d\d|2[0-4]\d|25[0-5])(\.(?!$)|(?=$))){4}$/.test(ip||'')) {
    throw new Error('Invalid IP');
  }

  const {zoneId, record} = await getHostnameZone(hostname)

  await updateDNSRecord(zoneId, record, ip)
}

/**
 * Verifies if the provided hostname belongs to a known zone and it can edited
 * @param the hostname for which the DNS entry has to be updated
 */
async function getHostnameZone(hostname) {
  let response = await makeAPIRequest(`/zones`)
  if (!response.success) {
    throw new Error('Unable to access Cloudflare API to retrieve zones. Check API Token.')
  }

  const zoneId = response.result
    .filter(zone => hostname.endsWith(zone.name) && zone.status === 'active' && !zone.paused)
    .map(zone => zone.id)
    .shift()

  if (!zoneId) {
    throw new Error('Unable to find zone for hostname')
  }

  response = await makeAPIRequest(`/zones/${zoneId}/dns_records`)
  if (!response.success) {
    throw new Error('Unable to access Cloudflare API to DNS records of zone. Check API Token.')
  }

  const record = response.result
    .filter(record => record.name === hostname)
    .shift()

  if (!record) {
    throw new Error('DNS record does not exist for the given hostname. ' +
      'First you need to create the DNS record in Cloudflare.')
  }

  return {zoneId, record}
}

/**
 * Performs the call to Cloudflare domains API to update the DNS entry for the requested hostname
 * @param {*} zoneId 
 * @param {*} record 
 * @param {*} ip 
 */
async function updateDNSRecord(zoneId, record, ip) {
  const init = Object.assign({}, API_REQUEST, {
    method: 'PUT',
    body: JSON.stringify({
      type: record.type,
      name: record.name,
      content: ip,
    }),
  })

  const response = await makeAPIRequest(`/zones/${zoneId}/dns_records/${record.id}`, init)
  if (!response.success) {
    console.error(response.errors.shift())
    throw new Error('Unable to set DNS record for given hostname. Check API Token.')
  }
}

async function makeAPIRequest(path, req = API_REQUEST) {
  return await (await fetch(`${BASE_API}${path.startsWith('/') ? path : '/' + path}`, req)).json()
}

