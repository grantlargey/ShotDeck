// Imported into the API and Vite child processes through NODE_OPTIONS. The
// smoke may talk only to loopback services (Postgres, Vite, API, and the S3
// stub); an accidental external socket fails before DNS or a connection.
import net from "node:net";

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const connect = net.connect.bind(net);

function guardedConnect(...args) {
  const first = args[0];
  if (typeof first === "string") return connect(...args); // Unix-domain socket.

  const options = typeof first === "object" && first !== null ? first : {};
  const host = options.host ?? options.hostname ?? (typeof args[1] === "string" ? args[1] : "localhost");
  if (!loopbackHosts.has(host)) {
    throw new Error(`Browser smoke blocked an external socket to ${host}.`);
  }
  return connect(...args);
}

net.connect = guardedConnect;
net.createConnection = guardedConnect;
