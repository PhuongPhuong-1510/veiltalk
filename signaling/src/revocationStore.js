const { createClient } = require("redis");

async function createRevocationStore({ host, port }) {
  const client = createClient({ socket: { host, port: Number(port) } });
  client.on("error", (error) => console.error(`Signaling Redis error: ${error.message}`));
  await client.connect();
  return {
    async isRevoked(jwtId, userId, issuedAt) {
      if (typeof jwtId !== "string" || !jwtId || typeof userId !== "string" || !Number.isInteger(issuedAt)) return true;
      const [blacklisted, revokedAfter] = await Promise.all([
        client.exists(`jwt:blacklist:${jwtId}`),
        client.get(`jwt:user-revoked-after:${userId}`),
      ]);
      return blacklisted !== 0 || (revokedAfter !== null && issuedAt <= Number(revokedAfter));
    },
    close: () => client.quit(),
  };
}

module.exports = { createRevocationStore };
