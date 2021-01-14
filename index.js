const fs = require("fs");
const {Client, TravelMode} = require("@googlemaps/google-maps-services-js");

/**
 * Calculate Coordinate Distance
 * @param {{ latitude: number, longitude: number }} point1 
 * @param {{ latitude: number, longitude: number }} point2 
 */
function distance(point1, point2) {
  const radlat1 = Math.PI * point1.latitude/180;
  const radlat2 = Math.PI * point2.latitude/180;
  const theta = point1.longitude-point2.longitude;
  const radtheta = Math.PI * theta/180;
  let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
  dist = Math.acos(dist);
  dist = dist * 180/Math.PI;
  dist = dist * 60 * 1.1515 * 1.609344 * 1000; // Dist => Nautical Mile => Statute Mile => KM => Meters
  return dist;
}

// MAPS API Client
const client = new Client({});
const MAPS_API_KEY = process.env.MAPS_API_KEY;
let apiCounter = 0;
let apiTime = Date.now();
// Call API: Listing => DistanceMatrixRowElement
const callAPI = listing => new Promise(resolve => {
  const interval = setInterval(async () => {
    if (Date.now() - apiTime > 200) {
      clearInterval(interval);
      apiTime = Date.now();
      apiCounter++;
      console.log(`API called ${apiCounter} times`)
      const result = await client.distancematrix({ params: {
        key: MAPS_API_KEY,
        destinations: listing.resorts,
        origins: [listing],
        mode: TravelMode.driving,
      }});
      resolve(result.data.rows[0].elements);
    }
  }, 3000);
});

// Filter Listings: Listing[] => Listing[]
const filterListings = listings => listings
.filter((l, i, a) => a.some(l2 => l2.listingId === l.listingId || l2.detailsUrl === l.detailsUrl || l2.uid === l2.uid)) // Unique
.filter(l => l.host_internet_access ? l.host_internet_access === "1" : true) // WWOOF Internet
.filter(l => l.host_max_wwoofers ? l.host_max_wwoofers !== "1" : true) // WWOOF More than One WWOOFER
.filter(l => l.host_winter_wwoofing_ ? l.host_winter_wwoofing_ !== "1" : true) // WWOOF Winter WWOOFing OK
.filter(l => l.listingAccommodation ? l.listingAccommodation.trim() !== "1" && l.listingAccommodation.trim() !== "1 only" : true) // HelpX More than 1

// Get Embedded Listings->Resorts Distances: Listing[], Resort[] => EmbeddedListing[]
const embedResortsAndDistances = async (listings, resorts) => Promise.all(
  listings
  .map(l => ({
    ...l,
    resorts  // Embed Resorts
  }))
  .map(l => ({
    ...l,
    resorts: l.resorts.map(r => ({
      ...r,
      distance: distance(l, r), // Calculate Coordinate Distance (Km)
    }))
  }))
  .map(l => ({
    ...l,
    resorts: l.resorts.filter(r => r.distance < 150000 ) // Filter out Resorts > 150 km away 
  }))
  .filter(l => l.resorts.length > 0) // Filter out Listings with no Resorts within 150 km
  .map(async l => ({
    ...l,
    resorts: l.resorts.map(async (r, index) => ({
      ...r,
      driving: (await callAPI(l))[index], // Get Google Maps Driving Distance
    })),
  }))
);

// Filter Embedded Resorts: EmbeddedResort[] => EmbeddedResort[]
const filterEmbeddedResorts = resorts => resorts
  .filter(r => r.seasonPass !== null) // Only With Season Pass Available
  .filter(r => r.driving.status === "OK"); // Only Driveable Resorts

// Calculate Drive Score
const driveScore = resort => ((resort.driving.duration.value < (20 * 60)
      ? 1 // Anything under 20min gets max score
      : resort.driving.duration.value > (120 * 60)
      ? 0 // Anything over 120min gets min score
      : (-resort.driving.duration.value / 60) / 100 + 1.2 // Anything inbetween gets linear score
    ));

const resortScores = [0, 0, 0.5, 1, 0, 1, 1, 0, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 1, 1, 0.5, 1, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, 1, 0, 0.5, 0.5, 0.5, 1, 0.5];

// Score Embedded Resorts: Listing => Listing
const scoreEmbeddedResorts = resorts => filterEmbeddedResorts(resorts)
  .map(r => ({
    ...r,
    driveScore: driveScore(r),
    dopenessScore: resortScores[r.index],
    priceScore: (1 - ((r.seasonPass - 900) / (3777.90 - 900)))
  }))
  .map(r => ({ ...r, totalScore: 0.4 * r.driveScore + 0.4 * r.dopenessScore + 0.2 * r.priceScore }))
  .sort((a, b) => b.totalScore - a.totalScore); // Sort Descending Scores

// Score Listings
const scoreListings = listings => listings.map(l => {
  const scoredResorts = scoreEmbeddedResorts(l.resorts);
  const bestResort = scoredResorts[0];
  const best = bestResort ? bestResort.totalScore : 0; // Default to score of zero
  const rest = l.resorts
  .filter(r => r.driving.status === "OK") // Only Driveable Resorts
  .map(r => driveScore(r) * resortScores[r.index]) // Score
  .reduce((sum, score, index) => sum + score, 0); // Sum up Score
  return {
    ...l,
    resorts: scoredResorts,
    bestScore: best,
    restScore: rest,
    totalScore: 0.85 * best + 0.15 * rest
  };
});

const sortScoredListingsByScore = listings => listings.sort((a, b) => b.totalScore - a.totalScore);

/*
// Compare Embedded Resorts by their Driving Distance (Fallback to Distance)
const compareEmbeddedResorts = (a, b) => 
  (a.driving.status === "ZERO_RESULTS" || a.driving.status === "ZERO_RESULTS") ?
  a.distance - b.distance :
  a.driving.distance.value - b.driving.distance.value
);

// Sort Embedded Resorts by the Distance to their Listing
const sortEmbeddedResortsByDistance = (listings) => listings.map(l => ({
  ...l,
  resorts: l.resorts.sort(compareResorts)
}));

// Sort Listings By Distance to Their Closest Resort
const sortListingsByClosestEmbeddedResort = (listings) => sortEmbeddedResortsByDistance(listings)
  .sort((a, b) => compareResorts(a.resorts[0], b.resorts[0]));
 */

// Listing Data Accessors
const url = listing => listing.friendlyUrl ? `https://helpx.net/host/${listing.friendlyUrl}` : listing.detailsUrl ? `https://workaway.info${listing.detailsUrl}` : listing.uid ? `https://wwoof.ca/user/${listing.uid}` : "?"
const name = listing => listing.listingName || listing.name || listing.displayName;
const workawayMinTwo = JSON.parse(fs.readFileSync("workaway-feb-mar-couple-wifi.json")).map(l => l.detailsUrl);
const allowedVisitors = listing => listing.host_max_wwoofers ? listing.host_max_wwoofers : listing.listingAccommodation ? listing.listingAccommodation : listing.detailsUrl ? workawayMinTwo.some(url => url === listing.detailsUrl) ? "2" : "?" : "?";
const city = (listing) => listing.city || "?";
const region = (listing) => listing.regionName || "?";
const internet = (listing) => listing.host_internet_access === "1" || listing.detailsUrl !== undefined ||  "?";

const cleanResortOutput = resort => ({
  name: resort.name,
  driveDurationText: resort.driving.duration.text,
  driveDistanceKM: resort.driving.distance.value / 1000,
  driveDurationMin: resort.driving.duration.value / 60,
  driveScore: resort.driveScore,
  dopenessScore: resort.dopenessScore,
  priceScore: resort.priceScore, 
  totalScore: resort.totalScore, 
});

const cleanOutput = listings => listings.map(l => ({
  url: url(l),
  name: name(l),
  latitude: l.latitude,
  longitude: l.longitude,
  visitors: allowedVisitors(l),
  city: city(l),
  region: region(l),
  internet: internet(l),
  numReviews: l.reviewsReceived || "?",
  averageRating: l.averageRating || "?",
  totalScore: l.totalScore,
  bestScore: l.bestScore,
  restScore: l.restScore,
  numResorts: l.resorts.length,
  resortOne: l.resorts[0] ? cleanResortOutput(l.resorts[0]) : undefined,
  resortTwo: l.resorts[1] ? cleanResortOutput(l.resorts[1]) : undefined,
  resortThree: l.resorts[2] ? cleanResortOutput(l.resorts[2]) : undefined,
}))

/* SCRIPT */
const buildDataSet = async () => {
    // Parse Resorts File
  const resorts = JSON.parse(fs.readFileSync("resorts.json"));
  console.log("Resorts: ", resorts.length)

  // Parse Listings Files
  const OGListings = ([
    ...JSON.parse(fs.readFileSync("helpX.json")),
    ...JSON.parse(fs.readFileSync("workaway-feb-mar-nomad-wifi.json")),
    ...JSON.parse(fs.readFileSync("workaway-feb-mar-couple-wifi.json")),
    ...JSON.parse(fs.readFileSync("woof.json"))]);
  console.log("OG Listings: ", OGListings.length);
  /* 
  const filtered = filterListings(OGListings);
  console.log("Filtered: ", filtered.length)
  const embedded = await embedResortsAndDistances(filtered, resorts);
  console.log("Embedded: ", embedded.length)
  const scored = scoreListings(embedded);
   */
  const filtered = filterListings(JSON.parse(fs.readFileSync("results.json")));
  const scored = scoreListings(filtered);
  console.log("Scored: ", scored.length);
  console.log("Mean Score: ", scored.reduce((avg, l, _, { length }) => avg + l.totalScore / length, 0));
  console.log("Min Score:", Math.min(...scored.map(l => l.totalScore)));
  console.log("Max Score:", Math.max(...scored.map(l => l.totalScore)));
  const sorted = sortScoredListingsByScore(scored);
  console.log("Sorted: ", sorted.length);
  const output = cleanOutput(sorted)
  fs.writeFileSync(`sorted-${Date.now()}.json`, JSON.stringify(sorted, null, 2));
  console.log("Saved");
}

buildDataSet();