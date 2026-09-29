'use strict';
// Quick hardware probe: list HID devices, try to open the AKP153, report what happens.
const HID = require('node-hid');
const { CANDIDATES } = require('./device-host.js');

const all = HID.devices();
console.log('total HID devices:', all.length);
const matches = [];
for (const c of CANDIDATES) {
  for (const d of all) {
    if (d.vendorId === c.vendorId && d.productId === c.productId) matches.push(d);
  }
}
console.log('AKP153 candidates:', JSON.stringify(matches, null, 1));

if (matches.length === 0) {
  console.log('RESULT: DEVICE_NOT_FOUND');
  process.exit(0);
}

for (const d of matches) {
  try {
    const h = new HID.HID(d.path);
    console.log('OPENED:', d.path, '| usagePage=', d.usagePage, 'usage=', d.usage);
    h.close();
    console.log('RESULT: OK');
    process.exit(0);
  } catch (e) {
    console.log('OPEN FAIL:', d.path, '->', e.message);
  }
}
console.log('RESULT: OPEN_FAILED');
