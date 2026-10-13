/*
 * Mocu UI SDK
 * Browser-side helper for extension app pages hosted in Mocu's sandboxed iframe.
 * Include this file before your app's own JavaScript.
 */
(function installMocuUiSdk(window) {
  "use strict";

  if (!window || !window.parent) return;

  const mocu = window.mocu = window.mocu || {};
  const pending = new Map();
  let sequence = 0;
  let defaultTimeoutMs = 180000;

  function makeRequestId() {
    sequence += 1;
    const randomPart = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `mocu-ui-${Date.now().toString(36)}-${sequence}-${randomPart}`;
  }

  function request(method, params, options) {
    if (typeof method !== "string" || !method.trim()) {
      return Promise.reject(new TypeError("Mocu request method must be a non-empty string."));
    }
    if (window.parent === window) {
      return Promise.reject(new Error("Mocu UI APIs are available only inside a Mocu extension iframe."));
    }

    const requestId = makeRequestId();
    const timeoutValue = options && options.timeoutMs !== undefined
      ? options.timeoutMs
      : defaultTimeoutMs;
    const timeoutMs = Number(timeoutValue);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new TypeError("timeoutMs must be a non-negative finite number."));
    }

    return new Promise((resolve, reject) => {
      const timeout = timeoutMs === 0
        ? null
        : window.setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`Mocu did not respond to '${method}' before the ${timeoutMs} ms timeout.`));
          }, timeoutMs);

      // Register before posting: a fast host reply must not race the pending map.
      pending.set(requestId, { resolve, reject, timeout });
      try {
        // The sandboxed app has an opaque origin, so the host currently requires "*".
        window.parent.postMessage({
          type: "mocu:request",
          requestId,
          method,
          params: params && typeof params === "object" ? params : {},
        }, "*");
      } catch (error) {
        pending.delete(requestId);
        if (timeout !== null) window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function handleMessage(event) {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if (message.type !== "mocu:response" || typeof message.requestId !== "string") return;

    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId);
    if (item.timeout !== null) window.clearTimeout(item.timeout);

    if (typeof message.error === "string" && message.error.length > 0) {
      item.reject(new Error(message.error));
    } else {
      item.resolve(message.result);
    }
  }

  window.addEventListener("message", handleMessage);

  mocu.version = "0.1.0";
  mocu.request = request;
  mocu.configure = function configure(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Mocu UI SDK configuration must be an object.");
    }
    if (options.timeoutMs !== undefined) {
      const timeoutMs = Number(options.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new TypeError("timeoutMs must be a non-negative finite number.");
      }
      defaultTimeoutMs = timeoutMs;
    }
  };

  mocu.extension = Object.assign(mocu.extension || {}, {
    request(method, params, options) {
      return request(method, params, options);
    },
    async execute(command, input, options) {
      if (typeof command !== "string" || !command.trim()) {
        throw new TypeError("Extension command must be a non-empty string.");
      }
      const result = await request("extension.execute", { command, input }, options);
      if (result && typeof result === "object" && result.success === false) {
        throw new Error(typeof result.error === "string" ? result.error : "The extension command failed.");
      }
      return result;
    },
  });

  mocu.filesystem = Object.assign(mocu.filesystem || {}, {
    request(method, params, options) {
      if (method !== "filesystem.chooseFolder" && method !== "filesystem.list" && method !== "filesystem.readText") {
        return Promise.reject(new TypeError("Unsupported Mocu filesystem method."));
      }
      return request(method, params, options);
    },
    chooseFolder(params, requestOptions) {
      return request("filesystem.chooseFolder", params || {}, requestOptions);
    },
    list(relativePath, requestOptions) {
      return request("filesystem.list", {
        relativePath: typeof relativePath === "string" ? relativePath : "",
      }, requestOptions);
    },
    async readText(relativePath, requestOptions) {
      if (typeof relativePath !== "string" || !relativePath.trim()) {
        throw new TypeError("filesystem.readText requires a non-empty relative path.");
      }
      const result = await request("filesystem.readText", { relativePath }, requestOptions);
      if (!result || typeof result.text !== "string") {
        throw new Error("Mocu returned an invalid filesystem.readText response.");
      }
      return result.text;
    },
  });

  mocu.selection = Object.assign(mocu.selection || {}, {
    async get(selectedText, requestOptions) {
      const text = typeof selectedText === "string"
        ? selectedText
        : (window.getSelection && window.getSelection()
          ? window.getSelection().toString()
          : "");
      return request("selection.get", { selectedText: text }, requestOptions);
    },
  });
})(window);
