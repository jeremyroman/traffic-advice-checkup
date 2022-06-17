<script setup>
import { reactive } from 'vue';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import OriginField from './OriginField.vue'

const DEFAULT_STATE = {
  status: "blank",
  googleP3: null,
  fetchIssue: null,
  statusIssue: null,
  mimeIssue: null,
  parseIssue: null,
  abortController: null,
};
const state = reactive({origin: "", ...DEFAULT_STATE});

async function fetchTrafficAdvice(e) {
  e.preventDefault();

  state.abortController?.abort();
  Object.assign(state, DEFAULT_STATE);
  state.abortController = new AbortController();
  let { signal } = state.abortController;

  let json;
  let headers;
  try {
    state.status = "loading";
    let response = await fetch(`/.netlify/functions/fetch?origin=${encodeURIComponent(state.origin)}`, {signal});
    if (!response.ok) {
      if (signal.aborted) return;
      state.status = error;
      return;
    }
    json = await response.json();
    headers = new Headers(json.headers);
    if (signal.aborted) return;
    state.status = "done";
  } catch (error) {
    if (signal.aborted) return;
    state.status = "error";
    return;
  }

  // Generic issues

  if (json.error) {
    state.fetchIssue = json.error;
    return;
  }

  if (json.status == 429 || json.status == 503) {
    state.statusIssue = {
      type: "unreachable",
      status: json.status,
      retryAfter: headers.get("retry-after")
    };
  } else if ([301, 302, 303, 307, 308].includes(json.status)) {
    state.statusIssue = {
      type: "redirect",
      status: json.status,
      location: headers.get("location")
    };
  } else if (json.status < 200 || json.status >= 300) {
    state.statusIssue = {
      type: "not-ok",
      status: json.status
    };
  } else if ([101, 103, 204, 205, 304].includes(json.status)) {
    state.statusIssue = {
      type: "null-body",
      status: json.status
    };
  }

  if (!state.statusIssue && json.essence !== "application/trafficadvice+json") {
    state.mimeIssue = {
      essence: json.essence,
      contentType: headers.get("content-type")
    };
  }

  let bodyDecoded;
  if (json.body) {
    const body = decodeBase64(json.body);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      bodyDecoded = decoder.decode(body);
    } catch (error) {
      state.parseIssue = "invalid-utf8";
    }
  }

  let advice;
  try {
    if (bodyDecoded !== undefined)
      advice = JSON.parse(bodyDecoded);
  } catch (error) {
    state.parseIssue = "invalid-json";
  }

  if (advice !== undefined && !(advice instanceof Array)) {
    state.parseIssue = "not-array";
  }

  // Google private prefetch proxy behavior

  let googleP3Outcome;
  let googleP3EAPFraction;
  let googleP3Fraction;
  let googleP3Entry;

  if (!state.origin.startsWith('https:')) {
    googleP3Outcome = "not-https";
    googleP3EAPFraction = googleP3Fraction = 0;
  } else if (state.fetchIssue) {
    googleP3Outcome = "fetch-error";
  } else if (json.status == 200 && (state.mimeIssue || state.parseIssue)) {
    googleP3Outcome = "fetch-error";
  } else if (json.status == 200) {
    googleP3Outcome = "has-advice";
    for (let entry of advice) {
      // This is the implemented behavior, though the spec suggests we should
      // prefer the most specific rather than the first.
      // TODO(jbroman): Consider addressing this, along with the fact that the
      // spec handling of mistyped values is much more lenient than the
      // implemented version.
      if (entry.user_agent === "Chrome Privacy Preserving Prefetch Proxy" ||
          entry.user_agent === "prefetch-proxy" ||
          entry.user_agent === "*") {
        if (entry.disallow === true) {
          googleP3Fraction = googleP3EAPFraction = 0;
        } else if (entry.disallow === false) {
          googleP3Fraction = googleP3EAPFraction = 1;
        } else {
          googleP3EAPFraction = 0;
          googleP3Fraction = 1;
        }

        if (typeof entry.google_prefetch_proxy_eap?.fraction === "number") {
          googleP3EAPFraction = entry.google_prefetch_proxy_eap.fraction;
        }
        if (typeof entry.fraction === "number") {
          googleP3EAPFraction = googleP3Fraction = entry.fraction;
        }
        googleP3Entry = entry;
        break;
      }
    }
    if (googleP3EAPFraction === undefined) {
      googleP3Outcome = "no-match";
      googleP3EAPFraction = 0;
    }
  } else if (json.status == 404) {
    googleP3Outcome = "advice-not-provided";
  } else {
    googleP3Outcome = "fetch-error";
    if (json.status == 429 || json.status == 503) {
      // TODO(jbroman): consider giving Retry-After info
    }
  }

  if (googleP3EAPFraction === undefined) {
    googleP3EAPFraction = 0;
  }
  if (googleP3Fraction === undefined) {
    googleP3Fraction = 1;
  }

  state.googleP3 = {
    outcome: googleP3Outcome,
    eapFraction: googleP3EAPFraction,
    fraction: googleP3Fraction,
    entry: googleP3Entry,
  };
}
</script>

<template>
  <form spellcheck="false">
    <OriginField v-model="state.origin" />
    <button @click="fetchTrafficAdvice">Check</button>
  </form>
  <div v-if="state.status == 'loading'" class="loading">Loading&hellip;</div>
  <div v-else-if="state.status == 'error'" class="analysis analysis-error"><div>
    An error occurred while trying to check that origin. Sorry about that.
  </div></div>
  <div v-if="state.fetchIssue" class="analysis analysis-error"><div>
    Unable to fetch <code>/.well-known/traffic-advice</code>.
    <template v-if="state.fetchIssue.error == 'unreachable'">A network error occurred before the response body started.</template>
    <template v-if="state.fetchIssue.error == 'body too large'">The response body was larger than this tool supports.</template>
    <template v-if="state.fetchIssue.error == 'error reading body'">A network error occurred while reading the response body.</template>
  </div></div>
  <div v-if="state.statusIssue?.type == 'unreachable'" class="analysis analysis-warning"><div>
    The response had status {{state.statusIssue.status}}, which indicates the server is unable to serve the traffic advice file, likely because it is too busy or undergoing maintenance.
    <template v-if="state.statusIssue.retryAfter">
      The response included the following <code>Retry-After</code> header, with value <code>{{state.statusIssue.retryAfter}}</code>.
    </template>
  </div></div>
  <div v-if="state.statusIssue?.type == 'redirect'" class="analysis analysis-warning"><div>
    The server served a {{state.statusIssue.status}} redirect to <code>{{state.statusIssue.location}}</code>. Traffic advice requests cannot be redirected, because they must be a suggestion from the particular server being contacted.
  </div></div>
  <div v-if="state.statusIssue?.type == 'not-ok' && state.statusIssue?.status == 404" class="analysis analysis-info"><div>
    The response was <code>404 Not Found</code>, which indicates this server is not providing traffic advice. If you expect it to, make sure the path is <code>/.well-known/traffic-advice</code> exactly.
  </div></div>
  <div v-else-if="state.statusIssue?.type == 'not-ok'" class="analysis analysis-error"><div>
    The response had status {{state.statusIssue.status}}, but only ok statuses (usually, <code>200 OK</code>) are acceptable. Other statuses might indicate a problem on the server, or that the traffic advice file is not available at the correct path, <code>/.well-known/traffic-advice</code>.
  </div></div>
  <div v-if="state.statusIssue?.type == 'null-body'" class="analysis analysis-error"><div>
    The response had status {{state.statusIssue.status}}, which is a null body status. Traffic advice must be served in the response body, usually with a <code>200 OK</code> status.
  </div></div>
  <div v-if="state.mimeIssue" class="analysis analysis-error"><div>
    The response needed to have the MIME type <code>application/trafficadvice+json</code>, but the essence found was <code>{{state.mimeIssue.essence}}</code>. This was parsed from the <code>Content-Type</code> header, <code>{{state.mimeIssue.contentType}}</code>.
  </div></div>
  <div v-if="state.parseIssue == 'invalid-utf8'" class="analysis analysis-error"><div>
    The response was not valid UTF-8.
  </div></div>
  <div v-if="state.parseIssue == 'invalid-json'" class="analysis analysis-error"><div>
    The response was not valid JSON.
  </div></div>
  <div v-if="state.parseIssue == 'not-array'" class="analysis analysis-error"><div>
    The response was valid JSON, but must be an array.
  </div></div>
  <template v-if="state.googleP3">
    <h2>Chrome Private Prefetch Proxy</h2>
    <div class="fractions">
      <div class="fraction">
        <span class="fraction-label">EAP (current)</span>
        <span class="fraction-value">{{Math.round(state.googleP3.eapFraction * 100)}}%</span>
      </div>
      <div class="fraction">
        <span class="fraction-label">Future</span>
        <span class="fraction-value">{{Math.round(state.googleP3.fraction * 100)}}%</span>
      </div>
    </div>
    <div v-if="state.googleP3.outcome == 'not-https'" class="analysis analysis-warning"><div>
      This service will only proxy HTTPS traffic.
    </div></div>
    <div v-if="state.googleP3.outcome == 'no-match'" class="analysis analysis-info"><div>
      No advice entry matching the service was found. To give advice specifically to Chrome's Private Prefetch Proxy, an entry with one of <code>"Chrome Privacy Preserving Prefetch Proxy"</code>, <code>"prefetch-proxy"</code> (preferred) or <code>"*"</code> must exist.
    </div></div>
    <p>This is a debugging aid to assist in understanding what how your traffic advice is expected to be interpreted, and indicates the maximum fraction of proxied prefetch traffic the server would prefer to receive.</p>
    <details v-if="state.googleP3.entry" class="analysis-entry">
      <summary>Advice used</summary>
      <pre>{{JSON.stringify(state.googleP3.entry, null, 4)}}</pre>
    </details>
  </template>
</template>

<style scoped>
form {
  display: flex;
}

input {
  background: var(--color-background-soft);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 0.3em 0.5em;
  font-size: 1.5em;
  outline: none;
  width: 0;
  flex: 1;
}

button {
  background: var(--color-button);
  color: var(--vt-c-white-mute);
  font: inherit;
  border: 1px solid var(--color-border);
  padding: 0 1em;
}

input:focus, input:hover, button:focus, button:hover {
  border-color: var(--color-border-hover);
}

.analysis {
  margin: 0.5em 0;
  border: 1px solid;
  padding: 1em;
  display: flex;
}

.analysis::before {
  font-size: 2em;
  margin: 0 0.5em 0 0;
  min-width: 1.5em;
  text-align: center;
}

.analysis-info {
  background-color: var(--color-info-background);
  border-color: var(--color-info-border);
}

.analysis-info::before {
  content: '🛈';
}

.analysis-warning {
  background-color: var(--color-warning-background);
  border-color: var(--color-warning-border);
}

.analysis-warning::before {
  content: '⚠️';
}

.analysis-error {
  background-color: var(--color-error-background);
  border-color: var(--color-error-border);
}

.analysis-error::before {
  content: '❌';
}

h2 {
  margin-top: 2em;
  text-align: center;
}

@media (max-width: 500px) {
  h2 { font-size: 1.2em; }
}

.fractions {
  display: flex;
  justify-content: center;
  margin: 1em 0;
  padding: 1em;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.fraction {
  margin: 0 2em;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.fraction span {
  display: block;
}

.fraction-label {
  font-weight: bold;
  text-transform: uppercase;
}

.fraction-value {
  font-size: 2em;
  font-weight: bold;
}

.analysis-entry pre {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  padding: 1em;
  overflow: auto;
}

.loading {
  text-align: center;
}
</style>
