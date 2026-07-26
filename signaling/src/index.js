require("dotenv").config({ quiet: true });

const { createServer } = require("./server");

const port = process.env.PORT || 3000;
const jwtSecret = process.env.SIGNALING_JWT_SECRET;

if (!jwtSecret) {
  console.error("SIGNALING_JWT_SECRET is required to start the signaling server");
  process.exit(1);
}

createServer({ port, jwtSecret });

console.log(`VeilTalk signaling server listening on port ${port}`);
