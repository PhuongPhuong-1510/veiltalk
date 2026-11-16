const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');

function snapshotDev() {
  const names = ['veiltalk-postgres-1', 'veiltalk-redis-1', 'veiltalk-minio-1'];
  const ids = names.map(name => docker('inspect', '-f', '{{.Id}}', name));
  const dbUser = docker('exec', names[0], 'printenv', 'POSTGRES_USER');
  const dbName = docker('exec', names[0], 'printenv', 'POSTGRES_DB');
  const tables = ['users', 'avatar_profiles', 'conversations', 'messages', 'videos', 'refresh_tokens', 'video_cleanup_jobs'];
  const tableHashes = tables.map(table => docker('exec', names[0], 'psql', '-U', dbUser, '-d', dbName, '-At', '-c',
    `SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) FROM ${table} t`));
  const buckets = docker('exec', names[2], 'ls', '-a', '/data').split(/\s+/).filter(name => name && !name.startsWith('.'));
  return {
    ids,
    databaseHash: hash(tableHashes.join('\n')),
    redisHash: hash(docker('exec', names[1], 'redis-cli', '--raw', 'DBSIZE') + '\n'
      + docker('exec', names[1], 'redis-cli', '--raw', '--scan')),
    minioHash: hash(buckets.sort().map(bucket => `${bucket}\n${docker('exec', names[2], 'ls', '-aR', `/data/${bucket}`)}`).join('\n')),
  };
}
if (require.main === module) console.log(snapshotDev());
module.exports = { snapshotDev };
