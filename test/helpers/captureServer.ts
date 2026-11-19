import http from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface CaptureServer {
  url: string;
  requests: CapturedRequest[];
  /** Status code to respond with for the NEXT request (defaults to 200). Shifts off an array if set. */
  responseQueue: number[];
  close: () => Promise<void>;
}

export async function startCaptureServer(): Promise<CaptureServer> {
  const requests: CapturedRequest[] = [];
  const responseQueue: number[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const status = responseQueue.shift() ?? 200;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end("received");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/forward`,
    requests,
    responseQueue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
