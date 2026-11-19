// Generated from src/openrpc.json; do not edit.
export const webPolicy = {
  "workdown.export": {
    "web": true,
    "execution": "asUser",
    "audit": "standard"
  },
  "exchange.start": {
    "web": true,
    "execution": "asUser",
    "audit": "standard"
  },
  "document.get": {
    "web": true,
    "execution": "asApp",
    "audit": "standard"
  },
  "publication.status": {
    "web": true,
    "execution": "asApp",
    "audit": "standard"
  }
} as const;
