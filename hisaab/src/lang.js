// Languages: HINTS (prompt hints for Ritu's parser) and SAY (fixed reply templates).
// Replies never depend on the AI. Missing language or message falls back to English.
export const LANGS = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };

export const HINTS = {
  en: 'Hinglish: aadha=0.5, pav=0.25, dedh=1.5, dhai=2.5; bees=20, tees=30, chalis=40, pachas=50, saath=60. ' +
      'nahi aaya/aayi, chhutti = absent; zyada/extra = extra; kam = less; advance diya = advance. ' +
      'tamatar=tomato, pyaaz=onion, aloo=potato, bhindi=bhindi, dhaniya=coriander.',
  hi: 'Hindi may be in Devanagari: आधा=0.5, डेढ़=1.5, ढाई=2.5; बीस=20, तीस=30, चालीस=40, पचास=50, साठ=60. ' +
      'नहीं आई/नहीं आया, छुट्टी = absent; ज़्यादा = extra; कम = less; एडवांस = advance. ' +
      'टमाटर=tomato, प्याज़=onion, आलू=potato, भिंडी=bhindi, धनिया=coriander, दूधवाला=milkman.',
  ta: 'Tamil may be in Tamil script or Roman: arai/அரை=0.5; irubadhu/இருபது=20, muppadhu/முப்பது=30, ' +
      'naarpadhu/நாற்பது=40, aimbadhu/ஐம்பது=50, arubadhu/அறுபது=60, nooru/நூறு=100. ' +
      'varala/வரல/வரவில்லை = absent; adhigam/அதிகம் = extra; kammi/கம்மி = less; advance kuduthen = advance. ' +
      'thakkali/தக்காளி=tomato, vengayam/வெங்காயம்=onion, urulaikizhangu/உருளைக்கிழங்கு=potato, ' +
      'vendakkai/வெண்டைக்காய்=bhindi, kothamalli/கொத்தமல்லி=coriander, paalkaaran/பால்காரர்=milkman, kadai=shop.'
};

export const hints = (lang) => HINTS[lang] ?? HINTS.en;

// Display names used only inside spoken/shown replies (storage stays English).
const ITEMS = {
  hi: { tomato: 'टमाटर', onion: 'प्याज़', potato: 'आलू', bhindi: 'भिंडी', coriander: 'धनिया' },
  ta: { tomato: 'தக்காளி', onion: 'வெங்காயம்', potato: 'உருளைக்கிழங்கு', bhindi: 'வெண்டைக்காய்', coriander: 'கொத்தமல்லி' }
};
const UNITS = {
  hi: { litre: 'लीटर', kg: 'किलो', dozen: 'दर्जन', piece: 'नग', bunch: 'गुच्छा' },
  ta: { litre: 'லிட்டர்', kg: 'கிலோ', dozen: 'டஜன்', piece: 'எண்ணம்', bunch: 'கட்டு' }
};

const r = (n) => Math.round(Number(n));
const u = (unit) => (unit ? ` ${unit}` : '');
const cheap = (c, join) => (c ? join(c.vendor, r(c.price)) : '');

// Every template takes ONE object. Variables used per message are listed in the comment.
export const SAY = {
  en: {
    absent: ({ name }) => `Noted — ${name} is absent today.`,                                  // name
    extra: ({ name, qty, unit }) => `Noted — ${name} gave ${qty}${u(unit)} extra.`,             // name, qty, unit?
    less: ({ name, qty, unit }) => `Noted — ${name} gave ${qty}${u(unit)} less.`,               // name, qty, unit?
    advance: ({ name, amount }) => `Advance of ₹${r(amount)} to ${name} noted.`,                // name, amount
    visit: ({ name, qty }) => `Noted — ${qty} for ${name}.`,                                    // name, qty
    bill: ({ name, total }) => `You owe ${name} ₹${r(total)} this month.`,                      // name, total
    summary: ({ total, count }) => `This month you owe ₹${r(total)} in total across ${count} helpers.`, // total, count
    priceHigh: ({ price, baseline, cheapest }) =>                                               // price, baseline, cheapest? {vendor, price}
      `Arre! Usually ₹${r(baseline)}, today ₹${r(price)}? Bargain a little. ${cheap(cheapest, (v, p) => `${v} had it at ₹${p}.`)}`.trim(),
    priceLow: ({ item, price, baseline }) => `Good deal! ${item} at ₹${r(price)}, usually ₹${r(baseline)}.`,
    priceNormal: ({ item, price }) => `${item} at ₹${r(price)} — a fair price.`,
    priceNew: ({ item, price }) => `Noted ${item} at ₹${r(price)}. A bit more data and I can warn you.`,
    priceCheck: ({ item, avg, min, max, cheapestVendor }) =>                                    // item, avg, min, max, cheapestVendor?
      `${item} is usually ₹${r(avg)} (₹${r(min)} to ₹${r(max)}).${cheapestVendor ? ` Cheapest at ${cheapestVendor}.` : ''}`,
    helperAdded: ({ name }) => `Added ${name}.`,
    priceNone: ({ item }) => `No price history for ${item} yet.`,
    undo: () => 'Done, removed the last entry.',
    clarify: () => "Sorry, I didn't get that. Could you say it again?",
    error: () => 'Sorry, something went wrong. Please try again.'
  },
  hi: {
    absent: ({ name }) => `${name} की आज की छुट्टी दर्ज हो गई।`,
    extra: ({ name, qty, unit }) => `${name} ने ${qty}${u(unit)} ज़्यादा दिया, दर्ज हो गया।`,
    less: ({ name, qty, unit }) => `${name} ने ${qty}${u(unit)} कम दिया, दर्ज हो गया।`,
    advance: ({ name, amount }) => `${name} को ₹${r(amount)} एडवांस दिया, दर्ज हो गया।`,
    visit: ({ name, qty }) => `${name} के ${qty} नग दर्ज हो गए।`,
    bill: ({ name, total }) => `इस महीने ${name} को ₹${r(total)} देना है।`,
    summary: ({ total, count }) => `इस महीने ${count} लोगों को कुल ₹${r(total)} देना है।`,
    priceHigh: ({ price, baseline, cheapest }) =>
      `अरे! आमतौर पर ₹${r(baseline)} होता है, आज ₹${r(price)}? थोड़ा मोल-भाव करो। ${cheap(cheapest, (v, p) => `${v} पर ₹${p} था।`)}`.trim(),
    priceLow: ({ item, price, baseline }) => `बढ़िया सौदा! ${item} ₹${r(price)}, आमतौर पर ₹${r(baseline)}।`,
    priceNormal: ({ item, price }) => `${item} ₹${r(price)}, सही भाव है।`,
    priceNew: ({ item, price }) => `${item} ₹${r(price)} दर्ज हो गया। भाव समझने के लिए थोड़ा और डेटा चाहिए।`,
    priceCheck: ({ item, avg, min, max, cheapestVendor }) =>
      `${item} आमतौर पर ₹${r(avg)} का मिलता है (₹${r(min)} से ₹${r(max)})।${cheapestVendor ? ` सबसे सस्ता ${cheapestVendor} पर।` : ''}`,
    helperAdded: ({ name }) => `${name} जोड़ दिया गया।`,
    priceNone: ({ item }) => `${item} का अभी कोई भाव दर्ज नहीं है।`,
    undo: () => 'ठीक है, आखिरी एंट्री हटा दी।',
    clarify: () => 'माफ़ कीजिए, समझ नहीं आया। एक बार फिर बोलिए?',
    error: () => 'माफ़ कीजिए, कुछ गड़बड़ हो गई। फिर कोशिश कीजिए।'
  },
  ta: {
    absent: ({ name }) => `${name} இன்று வரவில்லை, பதிவு செய்தேன்.`,
    extra: ({ name, qty, unit }) => `${name}: ${qty}${u(unit)} அதிகம், பதிவு செய்தேன்.`,
    less: ({ name, qty, unit }) => `${name}: ${qty}${u(unit)} குறைவு, பதிவு செய்தேன்.`,
    advance: ({ name, amount }) => `${name}-க்கு ₹${r(amount)} அட்வான்ஸ் பதிவு செய்தேன்.`,
    visit: ({ name, qty }) => `${name}: ${qty} எண்ணிக்கை பதிவு செய்தேன்.`,
    bill: ({ name, total }) => `இந்த மாதம் ${name}-க்கு ₹${r(total)} கொடுக்க வேண்டும்.`,
    summary: ({ total, count }) => `இந்த மாதம் ${count} பேருக்கு மொத்தம் ₹${r(total)} கொடுக்க வேண்டும்.`,
    priceHigh: ({ price, baseline, cheapest }) =>
      `அடடா! வழக்கமாக ₹${r(baseline)}, இன்று ₹${r(price)}? கொஞ்சம் பேரம் பேசுங்கள். ${cheap(cheapest, (v, p) => `${v}-ல் ₹${p} இருந்தது.`)}`.trim(),
    priceLow: ({ item, price, baseline }) => `நல்ல விலை! ${item} ₹${r(price)}, வழக்கமாக ₹${r(baseline)}.`,
    priceNormal: ({ item, price }) => `${item} ₹${r(price)}, சரியான விலை.`,
    priceNew: ({ item, price }) => `${item} ₹${r(price)} பதிவு செய்தேன். விலை தெரிய இன்னும் கொஞ்சம் தரவு வேண்டும்.`,
    priceCheck: ({ item, avg, min, max, cheapestVendor }) =>
      `${item} வழக்கமாக ₹${r(avg)} (₹${r(min)} முதல் ₹${r(max)}).${cheapestVendor ? ` மலிவானது ${cheapestVendor}.` : ''}`,
    helperAdded: ({ name }) => `${name} சேர்க்கப்பட்டது.`,
    priceNone: ({ item }) => `${item} விலை இன்னும் பதிவாகவில்லை.`,
    undo: () => 'சரி, கடைசி பதிவை நீக்கிவிட்டேன்.',
    clarify: () => 'மன்னிக்கவும், புரியவில்லை. மறுபடி சொல்லுங்களேன்?',
    error: () => 'மன்னிக்கவும், ஏதோ தவறு. மறுபடி முயற்சி செய்யுங்கள்.'
  }
};

// say('hi', 'absent', { name: 'Shanti didi' }) -> Hindi line. Falls back to English.
export function say(lang, key, vars = {}) {
  const v = { ...vars };
  if (v.item) v.item = ITEMS[lang]?.[v.item] ?? (lang === 'hi' || lang === 'ta' ? v.item : v.item[0].toUpperCase() + v.item.slice(1));
  if (v.unit) v.unit = UNITS[lang]?.[v.unit] ?? v.unit;
  return (SAY[lang]?.[key] ?? SAY.en[key])(v);
}
