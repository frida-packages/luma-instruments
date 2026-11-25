var counter = 0;
var seenMarker;
var config = { speed: 3, name: hostName, tags: ["red", "green"], nested: { deeper: { deepest: [1, 2] } } };
var bundleMarker = "react-native-test-bundle";

function tick(source) {
  counter++;
  if (globalThis.marker !== seenMarker) {
    seenMarker = globalThis.marker;
    nativeReport("observed marker = " + seenMarker);
  }
  var garbage = [];
  for (var i = 0; i < 64; i++) {
    garbage.push(String(i) + hostName + source);
  }
  return counter;
}

var padding = [
  "row 000 of text that makes this bundle about as large as a small app's",
  "row 001 of text that makes this bundle about as large as a small app's",
  "row 002 of text that makes this bundle about as large as a small app's",
  "row 003 of text that makes this bundle about as large as a small app's",
  "row 004 of text that makes this bundle about as large as a small app's",
  "row 005 of text that makes this bundle about as large as a small app's",
  "row 006 of text that makes this bundle about as large as a small app's",
  "row 007 of text that makes this bundle about as large as a small app's",
  "row 008 of text that makes this bundle about as large as a small app's",
  "row 009 of text that makes this bundle about as large as a small app's",
  "row 010 of text that makes this bundle about as large as a small app's",
  "row 011 of text that makes this bundle about as large as a small app's",
  "row 012 of text that makes this bundle about as large as a small app's",
  "row 013 of text that makes this bundle about as large as a small app's",
  "row 014 of text that makes this bundle about as large as a small app's",
  "row 015 of text that makes this bundle about as large as a small app's",
  "row 016 of text that makes this bundle about as large as a small app's",
  "row 017 of text that makes this bundle about as large as a small app's",
  "row 018 of text that makes this bundle about as large as a small app's",
  "row 019 of text that makes this bundle about as large as a small app's",
  "row 020 of text that makes this bundle about as large as a small app's",
  "row 021 of text that makes this bundle about as large as a small app's",
  "row 022 of text that makes this bundle about as large as a small app's",
  "row 023 of text that makes this bundle about as large as a small app's",
  "row 024 of text that makes this bundle about as large as a small app's",
  "row 025 of text that makes this bundle about as large as a small app's",
  "row 026 of text that makes this bundle about as large as a small app's",
  "row 027 of text that makes this bundle about as large as a small app's",
  "row 028 of text that makes this bundle about as large as a small app's",
  "row 029 of text that makes this bundle about as large as a small app's",
  "row 030 of text that makes this bundle about as large as a small app's",
  "row 031 of text that makes this bundle about as large as a small app's",
  "row 032 of text that makes this bundle about as large as a small app's",
  "row 033 of text that makes this bundle about as large as a small app's",
  "row 034 of text that makes this bundle about as large as a small app's",
  "row 035 of text that makes this bundle about as large as a small app's",
  "row 036 of text that makes this bundle about as large as a small app's",
  "row 037 of text that makes this bundle about as large as a small app's",
  "row 038 of text that makes this bundle about as large as a small app's",
  "row 039 of text that makes this bundle about as large as a small app's",
  "row 040 of text that makes this bundle about as large as a small app's",
  "row 041 of text that makes this bundle about as large as a small app's",
  "row 042 of text that makes this bundle about as large as a small app's",
  "row 043 of text that makes this bundle about as large as a small app's",
  "row 044 of text that makes this bundle about as large as a small app's",
  "row 045 of text that makes this bundle about as large as a small app's",
  "row 046 of text that makes this bundle about as large as a small app's",
  "row 047 of text that makes this bundle about as large as a small app's",
  "row 048 of text that makes this bundle about as large as a small app's",
  "row 049 of text that makes this bundle about as large as a small app's",
  "row 050 of text that makes this bundle about as large as a small app's",
  "row 051 of text that makes this bundle about as large as a small app's",
  "row 052 of text that makes this bundle about as large as a small app's",
  "row 053 of text that makes this bundle about as large as a small app's",
  "row 054 of text that makes this bundle about as large as a small app's",
  "row 055 of text that makes this bundle about as large as a small app's",
  "row 056 of text that makes this bundle about as large as a small app's",
  "row 057 of text that makes this bundle about as large as a small app's",
  "row 058 of text that makes this bundle about as large as a small app's",
  "row 059 of text that makes this bundle about as large as a small app's",
  "row 060 of text that makes this bundle about as large as a small app's",
  "row 061 of text that makes this bundle about as large as a small app's",
  "row 062 of text that makes this bundle about as large as a small app's",
  "row 063 of text that makes this bundle about as large as a small app's",
  "row 064 of text that makes this bundle about as large as a small app's",
  "row 065 of text that makes this bundle about as large as a small app's",
  "row 066 of text that makes this bundle about as large as a small app's",
  "row 067 of text that makes this bundle about as large as a small app's",
  "row 068 of text that makes this bundle about as large as a small app's",
  "row 069 of text that makes this bundle about as large as a small app's",
  "row 070 of text that makes this bundle about as large as a small app's",
  "row 071 of text that makes this bundle about as large as a small app's",
  "row 072 of text that makes this bundle about as large as a small app's",
  "row 073 of text that makes this bundle about as large as a small app's",
  "row 074 of text that makes this bundle about as large as a small app's",
  "row 075 of text that makes this bundle about as large as a small app's",
  "row 076 of text that makes this bundle about as large as a small app's",
  "row 077 of text that makes this bundle about as large as a small app's",
  "row 078 of text that makes this bundle about as large as a small app's",
  "row 079 of text that makes this bundle about as large as a small app's"
];
