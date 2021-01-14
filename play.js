const fs = require("fs");
const listings = JSON.parse(fs.readFileSync("results.json"));
const workaway = JSON.parse(fs.readFileSync("workaway-feb-mar-couple-wifi.json"));

const resortScores = [0, 0, 0.5, 1, 0, 1, 1, 0, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 1, 1, 0.5, 1, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, 1, 0, 0.5, 0.5, 0.5, 1, 0.5];

const resortScore = (resorts) => {
  const best = resorts
  .filter(r => r.seasonPass !== null) // Only With Season Pass Available
  .filter(r => r.driving.status === "OK") // Only Driveable Resorts
  .map(r => 
    0.4 * ((r.driving.duration.value < (20 * 60)
      ? 1 // Anything under 20min gets max score
      : r.driving.duration.value > (120 * 60)
      ? 0 // Anything over 120min gets min score
      : (-r.driving.duration.value / 60) / 100 + 1.2 // Anything inbetween gets linear score
    ))
    + 0.4 * resortScores[r.index]
    + 0.2 * (1 - ((r.seasonPass - 900) / (3777.90 - 900))) // Normalize Cost
  )
  .sort((a, b) => b - a) // Sort Descending Scores
  [0] || 0;
  const rest =  resorts
  .filter(r => r.driving.status === "OK") // Only Driveable Resorts
  .map(r => 
    ((r.driving.duration.value < (20 * 60)
      ? 1 // Anything under 20min gets max score
      : r.driving.duration.value > (120 * 60)
      ? 0 // Anything over 120min gets min score
      : (-r.driving.duration.value / 60) / 100 + 1.2 // Anything inbetween gets linear score
    )) * resortScores[r.index]
  )
  .reduce((sum, score, index) => sum + score, 0);
  return 0.85 * best + 0.15 * rest;
}

const url = (listing) => `https://helpx.net/host/${listing.friendlyUrl}` || `https://workaway.info${listing.detailsUrl}` || `https://wwoof.ca/user/${listing.uid}`
const name = (listing) => listing.listingName || listing.name || listing.displayName;

const scored = listings
.filter((l, i, a) => a.some(l2 => l2.listingId === l.listingId || l2.detailsUrl === l.detailsUrl || l2.uid === l2.uid)) // Filtered by Unique
.filter(l => l.host_internet_access ? l.host_internet_access === "1" : true) // WWOOF with Internet
.filter(l => l.host_max_wwoofers ? l.host_max_wwoofers !== "1" : true) // WWOOF More than One WWOOFER
.filter(l => l.host_winter_wwoofing_ ? l.host_winter_wwoofing_ !== "1" : true) // WWOOF Winter WWOOFing OK
.filter(l => l.listingAccommodation ? l.listingAccommodation.trim() !== "1" && l.listingAccommodation.trim() !== "1 only" : true) // HelpX More than 1
.map(l => ({
  ...l,
  __score: resortScore(l.resorts)
}))
.sort((a, b) => b.__score - a.__score); // Sort Descending

fs.writeFileSync("scored.json", JSON.stringify(scored.map(l => ({
  url: url(listing),
  name: name(listing),
  latitude: listing.latitude,
  longitude: listing.longitude,
  visitors: listing.host_max_wwoofers || listing.listingAccommodation || 
})), null, 2));

scored.slice(0, 10).map(listing => {
  console.log("\n");
  console.log("Score: ", listing.__score);
  console.log("ID: ", listing.listingId || listing.detailsUrl || listing.uid);
  console.log("URL: ", url(listing));
  console.log("Name: ", name(listing));
  listing.resorts.slice(0,3).map(r => {
    console.log("Resort: ", r.name);
    console.log("Driving: ", r.driving.duration.text);
  })
});
console.log("\n");
console.log("Total Listings: ", listings.length)
console.log("Filtered and Scored: ", scored.length)
console.log("Mean Score: ", scored.reduce((avg, l, _, { length }) => avg + l.__score / length, 0));
console.log("Min Score:", Math.min(...scored.map(l => l.__score)));
console.log("Max Score:", Math.max(...scored.map(l => l.__score)));

