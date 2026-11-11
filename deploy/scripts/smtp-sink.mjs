/**
 * smtp-sink.mjs — 极简 SMTP 收信端，只用于端到端验收。
 *
 * 为什么需要它：真机验收要证明「邮件真的发出去了」，但验收环境不该依赖外部邮箱。
 * 这个脚本只实现 SMTP 的最小命令集（EHLO/MAIL/RCPT/DATA/QUIT），
 * 收到一封信就追加一行 JSON 到日志文件，够断言「发了几封、发给谁」。
 *
 * 明确不支持：AUTH、STARTTLS、附件解析。它是测试夹具，不是邮件服务器。
 *
 * 用法：
 *   node smtp-sink.mjs [port] [outFile]
 *   node smtp-sink.mjs 2525 /tmp/smtp-inbox.log
 */
import net from "node:net";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 2525);
const outFile = process.argv[3] ?? "/tmp/smtp-inbox.log";

net
  .createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 smtp-sink ESMTP\r\n");

    let buffer = "";
    let inData = false;
    let rcpts = [];
    let data = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            appendFileSync(outFile, `${JSON.stringify({ to: rcpts, raw: data })}\n`);
            rcpts = [];
            data = "";
            socket.write("250 OK queued\r\n");
          } else {
            // dot-stuffing 反转义
            data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          // 不宣告 STARTTLS：让客户端走明文，夹具不需要证书
          socket.write("250-smtp-sink\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n");
        } else if (verb === "MAIL") {
          socket.write("250 OK\r\n");
        } else if (verb === "RCPT") {
          rcpts.push(line.replace(/^RCPT TO:\s*<?/i, "").replace(/>?\s*$/, ""));
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });

    socket.on("error", () => socket.destroy());
  })
  .listen(port, "127.0.0.1", () => {
    process.stdout.write(`smtp-sink listening on 127.0.0.1:${port} -> ${outFile}\n`);
  });
