import fetch from 'node-fetch';
import MIMEType from 'whatwg-mimetype';

export async function handler(event, context) {
  const jsonResponse = json => ({
    statusCode: 200,
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(json)
  });

  // Construct the traffic advice URL and confirm we're willing to fetch it.
  // This bypasses CORS, so we want it to be fairly narrow.
  const trafficAdviceURL = new URL("/.well-known/traffic-advice", event.queryStringParameters.origin);
  if (trafficAdviceURL.protocol != 'https:' && trafficAdviceURL.protocol != 'http:')
    throw new Error("invalid protocol");
  if (trafficAdviceURL.port)
    throw new Error("only default ports permitted");

  // Issue the request.
  let response;
  try {
    const headers = {
      "Accept": "application/trafficadvice+json",
      "User-Agent": "TrafficAdviceCheckup",
    };
    response = await fetch(trafficAdviceURL, { headers, redirect: "manual" });
  } catch (e) {
    console.log(e);
    return jsonResponse({ error: "unreachable" });
  }

  // Start gathering info to return to the client.
  let info = {
    type: response.type,
    status: response.status,
    headers: Array.from(response.headers),
  };

  // Compute the MIME type essence.
  // This *technically* should also work with multiple Content-Type headers.
  // But who does that?
  info.essence = MIMEType.parse(response.headers.get("content-type"))?.essence ?? null;

  // Only read the body if the response had the right essence.
  if (response.ok && info.essence === "application/trafficadvice+json") {
    const buffer = Buffer.alloc(512 * 1024);
    let offset = 0;
    try {
      for await (const chunk of response.body) {
        if (chunk.length > buffer.length - offset) {
          info.error = "body too large";
          break;
        }
        chunk.copy(buffer, offset);
        offset += chunk.length;
      }
    } catch (e) {
      console.log(e);
      info.error = "error reading body";
    }

    if (!info.error)
      info.body = buffer.toString('base64', 0, offset);
  }

  return jsonResponse(info);
}
