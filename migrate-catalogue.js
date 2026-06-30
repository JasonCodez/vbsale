require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
  region:      'auto',
  endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const data = fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8');
  console.log('Uploading catalogue.json to R2...');
  await r2.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         'data/catalogue.json',
    Body:        data,
    ContentType: 'application/json',
  }));
  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
