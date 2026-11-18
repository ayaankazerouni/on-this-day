// Runs before `npm run dev` and `npm run build`
// Stops them if WIKI_USERNAME isn't set.

if (!process.env.WIKI_USERNAME) {
  console.error(
    "WIKI_USERNAME is not set. Set it to your Wikimedia username, e.g.\n" +
      "  export WIKI_USERNAME=YourUsername\n" +
      "It's sent to Wikimedia's APIs as contact information in the User-Agent."
  );
  process.exit(1);
}
