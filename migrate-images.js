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

const BUCKET     = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const UPLOADS    = path.join(__dirname, 'public', 'uploads');
const CATALOGUE  = path.join(__dirname, 'catalogue.json');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function main() {
  const files = fs.readdirSync(UPLOADS).filter(f => !f.startsWith('.'));
  console.log(`Found ${files.length} images to upload.\n`);

  const urlMap = {};

  for (const file of files) {
    const key  = `uploads/${file}`;
    const ext  = path.extname(file).toLowerCase();
    const body = fs.readFileSync(path.join(UPLOADS, file));

    process.stdout.write(`Uploading ${file}...`);
    await r2.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        body,
      ContentType: MIME[ext] || 'application/octet-stream',
    }));
    console.log(' done');

    urlMap[`/uploads/${file}`] = `${PUBLIC_URL}/${key}`;
  }

  console.log(`\nUpdating catalogue.json...`);
  const data = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));

  for (const product of data.products) {
    if (product.image_url && urlMap[product.image_url]) {
      product.image_url = urlMap[product.image_url];
    }
    if (Array.isArray(product.images)) {
      product.images = product.images.map(url => urlMap[url] || url);
    }
  }

  fs.writeFileSync(CATALOGUE, JSON.stringify(data, null, 2), 'utf8');
  console.log('Done! All image URLs updated.');
}

main().catch(err => { console.error(err); process.exit(1); });
