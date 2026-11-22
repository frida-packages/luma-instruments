export const signatureAlgorithmNames = new Map([
    ["1.2.840.113549.1.1.4", "md5WithRSAEncryption"],
    ["1.2.840.113549.1.1.5", "sha1WithRSAEncryption"],
    ["1.2.840.113549.1.1.14", "sha224WithRSAEncryption"],
    ["1.2.840.113549.1.1.11", "sha256WithRSAEncryption"],
    ["1.2.840.113549.1.1.12", "sha384WithRSAEncryption"],
    ["1.2.840.113549.1.1.13", "sha512WithRSAEncryption"],
    ["1.2.840.113549.1.1.10", "RSASSA-PSS"],
    ["1.2.840.10040.4.3", "dsaWithSHA1"],
    ["2.16.840.1.101.3.4.3.2", "dsaWithSHA256"],
    ["1.2.840.10045.4.1", "ecdsa-with-SHA1"],
    ["1.2.840.10045.4.3.1", "ecdsa-with-SHA224"],
    ["1.2.840.10045.4.3.2", "ecdsa-with-SHA256"],
    ["1.2.840.10045.4.3.3", "ecdsa-with-SHA384"],
    ["1.2.840.10045.4.3.4", "ecdsa-with-SHA512"],
    ["1.3.101.112", "Ed25519"],
    ["1.3.101.113", "Ed448"],
    ["2.16.840.1.101.3.4.3.17", "ML-DSA-44"],
    ["2.16.840.1.101.3.4.3.18", "ML-DSA-65"],
    ["2.16.840.1.101.3.4.3.19", "ML-DSA-87"],
    ["1.2.156.10197.1.501", "SM2-with-SM3"],
]);

export const keyAlgorithms = {
    rsa: "1.2.840.113549.1.1.1",
    rsaPss: "1.2.840.113549.1.1.10",
    dsa: "1.2.840.10040.4.1",
    ec: "1.2.840.10045.2.1",
};

export const keyAlgorithmNames = new Map([
    ["1.3.101.110", "X25519"],
    ["1.3.101.111", "X448"],
    ["1.3.101.112", "Ed25519"],
    ["1.3.101.113", "Ed448"],
    ["2.16.840.1.101.3.4.3.17", "ML-DSA-44"],
    ["2.16.840.1.101.3.4.3.18", "ML-DSA-65"],
    ["2.16.840.1.101.3.4.3.19", "ML-DSA-87"],
    ["2.16.840.1.101.3.4.4.1", "ML-KEM-512"],
    ["2.16.840.1.101.3.4.4.2", "ML-KEM-768"],
    ["2.16.840.1.101.3.4.4.3", "ML-KEM-1024"],
]);

export const curveNames = new Map([
    ["1.2.840.10045.3.1.7", "P-256"],
    ["1.3.132.0.34", "P-384"],
    ["1.3.132.0.35", "P-521"],
    ["1.3.132.0.33", "P-224"],
    ["1.2.840.10045.3.1.1", "P-192"],
    ["1.3.132.0.10", "secp256k1"],
    ["1.3.36.3.3.2.8.1.1.7", "brainpoolP256r1"],
    ["1.3.36.3.3.2.8.1.1.11", "brainpoolP384r1"],
    ["1.3.36.3.3.2.8.1.1.13", "brainpoolP512r1"],
    ["1.2.156.10197.1.301", "SM2"],
]);

export const attributeTypeNames = new Map([
    ["2.5.4.3", "CN"],
    ["2.5.4.4", "SN"],
    ["2.5.4.5", "serialNumber"],
    ["2.5.4.6", "C"],
    ["2.5.4.7", "L"],
    ["2.5.4.8", "ST"],
    ["2.5.4.9", "street"],
    ["2.5.4.10", "O"],
    ["2.5.4.11", "OU"],
    ["2.5.4.12", "title"],
    ["2.5.4.15", "businessCategory"],
    ["2.5.4.17", "postalCode"],
    ["2.5.4.42", "GN"],
    ["2.5.4.46", "dnQualifier"],
    ["2.5.4.97", "organizationIdentifier"],
    ["0.9.2342.19200300.100.1.1", "UID"],
    ["0.9.2342.19200300.100.1.25", "DC"],
    ["1.2.840.113549.1.9.1", "emailAddress"],
    ["1.3.6.1.4.1.311.60.2.1.3", "jurisdictionC"],
]);

export const extensions = {
    keyUsage: "2.5.29.15",
    subjectAltName: "2.5.29.17",
    basicConstraints: "2.5.29.19",
    extendedKeyUsage: "2.5.29.37",
};

export const keyUsageNames = [
    "digitalSignature",
    "nonRepudiation",
    "keyEncipherment",
    "dataEncipherment",
    "keyAgreement",
    "keyCertSign",
    "cRLSign",
    "encipherOnly",
    "decipherOnly",
];

export const extendedKeyUsageNames = new Map([
    ["1.3.6.1.5.5.7.3.1", "serverAuth"],
    ["1.3.6.1.5.5.7.3.2", "clientAuth"],
    ["1.3.6.1.5.5.7.3.3", "codeSigning"],
    ["1.3.6.1.5.5.7.3.4", "emailProtection"],
    ["1.3.6.1.5.5.7.3.8", "timeStamping"],
    ["1.3.6.1.5.5.7.3.9", "OCSPSigning"],
    ["2.5.29.37.0", "anyExtendedKeyUsage"],
]);
