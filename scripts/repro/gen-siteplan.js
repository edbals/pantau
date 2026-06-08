// Generates a synthetic Indonesian site plan PNG mimicking the user's denah kavling.
// Multiple block rows (3J, 3H, 3G, 3F), each a horizontal strip of numbered lots,
// split by a central road. Used to reproduce the digitize pipeline offline.
const sharp = require('sharp')
const path = require('path')

function buildSvg() {
  const W = 2186
  const H = 734
  const rows = [
    { prefix: '3J', y: 40 },
    { prefix: '3H', y: 210 },
    { prefix: '3G', y: 380 },
    { prefix: '3F', y: 550 },
  ]
  const lotsLeft = 20
  const lotsRight = 21
  const cellH = 120
  const leftX = 20
  const gap = 60 // central road
  const usableW = W - 40 - gap
  const cellWLeft = (usableW / 2) / lotsLeft
  const cellWRight = (usableW / 2) / lotsRight
  const rightStartX = leftX + usableW / 2 + gap

  let rects = ''
  let labels = ''
  for (const { prefix, y } of rows) {
    // left group 1..20
    for (let i = 0; i < lotsLeft; i++) {
      const x = leftX + i * cellWLeft
      rects += `<rect x="${x}" y="${y}" width="${cellWLeft}" height="${cellH}" fill="white" stroke="black" stroke-width="2"/>`
      labels += `<text x="${x + cellWLeft / 2}" y="${y + cellH / 2 + 6}" font-size="18" text-anchor="middle" font-family="Arial">${prefix}${i + 1}</text>`
    }
    // right group 21..41
    for (let i = 0; i < lotsRight; i++) {
      const x = rightStartX + i * cellWRight
      rects += `<rect x="${x}" y="${y}" width="${cellWRight}" height="${cellH}" fill="white" stroke="black" stroke-width="2"/>`
      labels += `<text x="${x + cellWRight / 2}" y="${y + cellH / 2 + 6}" font-size="18" text-anchor="middle" font-family="Arial">${prefix}${21 + i}</text>`
    }
  }
  // central road label
  labels += `<text x="${leftX + usableW / 2 + gap / 2}" y="${H / 2}" font-size="22" text-anchor="middle" font-family="Arial" transform="rotate(90 ${leftX + usableW / 2 + gap / 2} ${H / 2})">JALAN UTAMA</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#f0f0f0"/>
    ${rects}
    ${labels}
  </svg>`
}

async function main() {
  const out = path.join(__dirname, 'siteplan.png')
  await sharp(Buffer.from(buildSvg())).png().toFile(out)
  const meta = await sharp(out).metadata()
  console.log(`Wrote ${out} — ${meta.width}x${meta.height}`)
}

main().catch(e => { console.error(e); process.exit(1) })
