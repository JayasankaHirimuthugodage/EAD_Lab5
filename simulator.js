require('dotenv').config(); 
const fs = require('fs'); 
const { Client, Message } = require('azure-iot-device'); 
const { Mqtt } = require('azure-iot-device-mqtt'); 
const connectionString = process.env.IOTHUB_DEVICE_CONNECTION_STRING; 
if (!connectionString) { 
throw new Error('Missing IOTHUB_DEVICE_CONNECTION_STRING in .env'); 
} 
const client = Client.fromConnectionString(connectionString, Mqtt); 
const DEVICE_ID = 'motor-sensor-01'; 
const SEND_INTERVAL_MS = 3000; 
const MAX_READINGS = 20; 
let sequence = 0; 
 
function randomBetween(min, max) { 
  return Number((Math.random() * (max - min) + min).toFixed(2)); 
} 
 
function readSensors() { 
  sequence += 1; 
  // Every 7th reading simulates a hotter, more heavily vibrating motor. 
  const abnormal = sequence % 7 === 0; 
  return { 
    deviceId: DEVICE_ID, 
    sequence, 
    timestamp: new Date().toISOString(), 
    temperatureC: abnormal ? randomBetween(61, 69) : randomBetween(36, 49), 
    humidityPct: randomBetween(48, 72), 
    vibrationMmS: abnormal ? randomBetween(8, 11) : randomBetween(2, 5) 
  }; 
} 
 
function classify(reading) { 
  if (reading.temperatureC >= 60 || reading.vibrationMmS >= 8) return 'critical'; 
  if (reading.temperatureC >= 50 || reading.vibrationMmS >= 6) return 'warning'; 
  return 'normal'; 
} 

function saveColdPath(reading) { 
  const exists = fs.existsSync('telemetry-cold-path.csv'); 
  if (!exists) { 
    fs.appendFileSync('telemetry-cold-path.csv', 
      'deviceId,sequence,timestamp,temperatureC,humidityPct,vibrationMmS,status\n'); 
  } 
  fs.appendFileSync('telemetry-cold-path.csv', 
    `${reading.deviceId},${reading.sequence},${reading.timestamp},` + 
    `${reading.temperatureC},${reading.humidityPct},${reading.vibrationMmS},${reading.status}\n`); 
} 

function createWorkOrder(reading) { 
  const workOrder = { 
    type: 'MAINTENANCE_WORK_ORDER_REQUESTED', 
    assetId: reading.deviceId, 
    priority: 'HIGH', 
    reason: `Critical telemetry: ${reading.temperatureC} C, ${reading.vibrationMmS} mm/s`, 
    createdAt: reading.timestamp, 
    sourceSequence: reading.sequence 
  }; 
  fs.appendFileSync('work-orders.jsonl', JSON.stringify(workOrder) + '\n'); 
  console.log('ERP EVENT:', workOrder); 
}

async function sendTelemetry(reading) { 
  const message = new Message(JSON.stringify(reading)); 
  message.contentType = 'application/json'; 
  message.contentEncoding = 'utf-8'; 
  message.properties.add('status', reading.status); 
  message.properties.add('source', 'edge-simulator'); 
  await client.sendEvent(message); 
  console.log('CLOUD:', reading); 
}

async function run() { 
  await client.open(); 
  console.log('Connected to Azure IoT Hub'); 
 
  const timer = setInterval(async () => { 
    try { 
      const reading = readSensors(); 
      reading.status = classify(reading); 
      saveColdPath(reading);                 // cold path: keep every reading 
 
      const heartbeat = reading.sequence % 5 === 0; 
      if (reading.status !== 'normal' || heartbeat) { 
        await sendTelemetry(reading);        // hot path: selected readings only 
      } else { 
        console.log('EDGE ONLY:', reading); 
      } 
 
      if (reading.status === 'critical') createWorkOrder(reading); 
 
      if (reading.sequence >= MAX_READINGS) { 
        clearInterval(timer); 
        await client.close(); 
        console.log('Finished. Review the CSV and JSONL output files.'); 
      } 
    } catch (error) { 
      console.error('Telemetry error:', error.message); 
    } 
  }, SEND_INTERVAL_MS); 
} 
 
run().catch(error => console.error('Startup error:', error.message));