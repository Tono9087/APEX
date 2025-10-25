const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function checkLocations() {
  try {
    await client.connect();
    const db = client.db('apex-db');
    const usuarios = await db.collection('victims').find({}).toArray();

    console.log(`Total usuarios: ${usuarios.length}`);

    const unknownLocations = usuarios.filter(v =>
      v.network?.city === 'Unknown' || v.network?.country === 'Unknown'
    );

    console.log(`Usuarios with Unknown location: ${unknownLocations.length}`);
    console.log(`Percentage: ${((unknownLocations.length / usuarios.length) * 100).toFixed(2)}%`);

    // Show sample
    if (unknownLocations.length > 0) {
      console.log('\nSample usuarios with Unknown location:');
      unknownLocations.slice(0, 3).forEach((sample, i) => {
        console.log(`\n${i+1}.`, {
          ip: sample.network?.ip,
          city: sample.network?.city,
          country: sample.network?.country,
          locationSource: sample.network?.locationSource,
          timestamp: sample.timestamp
        });
      });
    }

    // Check if there are GPS coordinates available
    const withGPS = unknownLocations.filter(v =>
      v.geolocation?.latitude && v.geolocation?.longitude
    );
    console.log(`\nUsuarios with Unknown location but GPS available: ${withGPS.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkLocations();
