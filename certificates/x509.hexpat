import std.core;
import std.mem;
import std.string;

Certificate certificate @ 0x00;

struct Certificate {
    Header header;
    TbsCertificate tbsCertificate;
    AlgorithmIdentifier signatureAlgorithm;
    Element signatureValue;
    str summary = tbsCertificate.subject.summary;
} [[format("summaryOf")]];

struct TbsCertificate {
    Header header;
    u128 end = endOf(header);
    if (nextTag() == 0xa0) {
        Element version;
    }
    Element serialNumber;
    AlgorithmIdentifier signature;
    Name issuer;
    Validity validity;
    Name subject;
    SubjectPublicKeyInfo subjectPublicKeyInfo;
    if ($ < end && nextTag() == 0x81) {
        Element issuerUniqueID;
    }
    if ($ < end && nextTag() == 0x82) {
        Element subjectUniqueID;
    }
    if ($ < end && nextTag() == 0xa3) {
        Extensions extensions;
    }
    str summary = subject.summary;
} [[format("summaryOf")]];

struct AlgorithmIdentifier {
    Header header;
    u128 end = endOf(header);
    ObjectIdentifier algorithm;
    if ($ < end) {
        Element parameters;
    }
    str summary = algorithm.summary;
} [[format("summaryOf")]];

struct Name {
    Header header;
    u128 end = endOf(header);
    RelativeDistinguishedName relativeNames[while($ < end)];
    str summary = joinedSummaries(relativeNames, ", ");
} [[format("summaryOf")]];

struct RelativeDistinguishedName {
    Header header;
    u128 end = endOf(header);
    AttributeTypeAndValue attributes[while($ < end)];
    str summary = joinedSummaries(attributes, " + ");
} [[format("summaryOf")]];

struct AttributeTypeAndValue {
    Header header;
    ObjectIdentifier type;
    Element value;
    str summary = std::format("{}={}", attributeName(type.dotted), value.summary);
} [[format("summaryOf")]];

struct Validity {
    Header header;
    Element notBefore;
    Element notAfter;
    str summary = std::format("{} to {}", notBefore.summary, notAfter.summary);
} [[format("summaryOf")]];

struct SubjectPublicKeyInfo {
    Header header;
    AlgorithmIdentifier algorithm;
    Element subjectPublicKey;
    str summary = algorithm.summary;
} [[format("summaryOf")]];

struct Extensions {
    Header header;
    Header list;
    u128 end = endOf(list);
    Extension extensions[while($ < end)];
    str summary = std::format("{} extensions", std::core::member_count(extensions));
} [[format("summaryOf")]];

struct Extension {
    Header header;
    ObjectIdentifier extnID;
    if (nextTag() == 0x01) {
        Element critical;
    }
    Header wrapper;
    Element extnValue;
    str summary = extnID.summary;
} [[format("summaryOf")]];

struct ObjectIdentifier {
    Header header;
    u8 arcs[header.length] [[hidden]];
    str dotted = dottedArcs(addressof(arcs), header.length);
    str summary = objectName(dotted);
} [[format("summaryOf")]];

struct Element {
    Header header;
    u128 end = endOf(header);
    if ((header.tag & 0x20) != 0) {
        Element children[while($ < end)];
        str summary = std::format("{} ({} elements)", tagName(header.tag), std::core::member_count(children));
    } else {
        u8 content[header.length];
        str summary = describeContent(header.tag, addressof(content), header.length);
    }
} [[format("summaryOf")]];

struct Header {
    u8 tag [[format("formatTag")]];
    u8 form [[hidden]];
    u8 longForm[(form & 0x80) != 0 ? form & 0x7f : 0] [[hidden]];
    u32 length = lengthOf(form, addressof(form) + 1);
    str summary = std::format("{}, {} bytes", tagName(tag), length);
} [[format("summaryOf")]];

fn summaryOf(ref auto value) {
    return value.summary;
};

fn endOf(ref Header header) {
    return addressof(header) + sizeof(header) + header.length;
};

fn nextTag() {
    return std::mem::read_unsigned($, 1);
};

fn joinedSummaries(ref auto items, str separator) {
    str joined = "";
    for (u32 i = 0, i < std::core::member_count(items), i += 1) {
        if (i != 0) {
            joined = joined + separator;
        }
        joined = joined + items[i].summary;
    }
    return joined;
};

fn describeContent(u8 tag, u128 address, u32 length) {
    match (tag) {
        (0x01): return (length == 1 && std::mem::read_unsigned(address, 1) != 0) ? "TRUE" : "FALSE";
        (0x02): return std::format("INTEGER {}", hexBytes(address, length));
        (0x03): return std::format("BIT STRING, {} bytes", length - 1);
        (0x04): return std::format("OCTET STRING, {} bytes", length);
        (0x05): return "NULL";
        (0x06): return objectName(dottedArcs(address, length));
        (0x17): return formatTime(withCentury(std::mem::read_string(address, length)));
        (0x18): return formatTime(std::mem::read_string(address, length));
        (0x0c | 0x13 | 0x14 | 0x16 | 0x1a): return std::mem::read_string(address, length);
        (0x80 ... 0x9f): return std::format("[{}] {}", tag & 0x1f, std::mem::read_string(address, length));
        (_): return std::format("{}, {} bytes", tagName(tag), length);
    }
};

fn formatTag(u8 tag) {
    return tagName(tag);
};

fn lengthOf(u8 form, u128 address) {
    if ((form & 0x80) == 0) {
        return form;
    }
    u32 length = 0;
    for (u8 i = 0, i < (form & 0x7f), i += 1) {
        length = length * 256 + std::mem::read_unsigned(address + i, 1);
    }
    return length;
};

fn dottedArcs(u128 address, u32 length) {
    str dotted = "";
    u128 arc = 0;
    for (u32 i = 0, i < length, i += 1) {
        u8 byte = std::mem::read_unsigned(address + i, 1);
        arc = arc * 128 + (byte & 0x7f);
        if ((byte & 0x80) == 0) {
            if (dotted == "") {
                if (arc < 80) {
                    dotted = std::format("{}.{}", arc / 40, arc % 40);
                } else {
                    dotted = std::format("2.{}", arc - 80);
                }
            } else {
                dotted = std::format("{}.{}", dotted, arc);
            }
            arc = 0;
        }
    }
    return dotted;
};

fn withCentury(str utcTime) {
    return std::format("{}{}", std::string::parse_int(std::string::substr(utcTime, 0, 2), 10) < 50 ? "20" : "19", utcTime);
};

fn formatTime(str digits) {
    return std::format("{}-{}-{} {}:{}:{} UTC", std::string::substr(digits, 0, 4), std::string::substr(digits, 4, 2),
        std::string::substr(digits, 6, 2), std::string::substr(digits, 8, 2), std::string::substr(digits, 10, 2),
        std::string::substr(digits, 12, 2));
};

fn hexBytes(u128 address, u32 length) {
    str hex = "";
    for (u32 i = 0, i < length && i < 32, i += 1) {
        hex = std::format("{}{:02x}", hex, std::mem::read_unsigned(address + i, 1));
    }
    return (length > 32) ? hex + "…" : hex;
};

fn tagName(u8 tag) {
    match (tag) {
        (0x01): return "BOOLEAN";
        (0x02): return "INTEGER";
        (0x03): return "BIT STRING";
        (0x04): return "OCTET STRING";
        (0x05): return "NULL";
        (0x06): return "OBJECT IDENTIFIER";
        (0x0c): return "UTF8String";
        (0x13): return "PrintableString";
        (0x14): return "TeletexString";
        (0x16): return "IA5String";
        (0x17): return "UTCTime";
        (0x18): return "GeneralizedTime";
        (0x1a): return "VisibleString";
        (0x1e): return "BMPString";
        (0x30): return "SEQUENCE";
        (0x31): return "SET";
        (0x80 ... 0x9f): return std::format("[{}]", tag & 0x1f);
        (0xa0 ... 0xbf): return std::format("[{}] EXPLICIT", tag & 0x1f);
        (_): return std::format("tag {:#04x}", tag);
    }
};

fn attributeName(str dotted) {
    match (dotted) {
        ("2.5.4.3"): return "CN";
        ("2.5.4.5"): return "serialNumber";
        ("2.5.4.6"): return "C";
        ("2.5.4.7"): return "L";
        ("2.5.4.8"): return "ST";
        ("2.5.4.10"): return "O";
        ("2.5.4.11"): return "OU";
        ("0.9.2342.19200300.100.1.25"): return "DC";
        ("1.2.840.113549.1.9.1"): return "emailAddress";
        (_): return dotted;
    }
};

fn objectName(str dotted) {
    match (dotted) {
        ("1.2.840.113549.1.1.1"): return "rsaEncryption";
        ("1.2.840.113549.1.1.5"): return "sha1WithRSAEncryption";
        ("1.2.840.113549.1.1.10"): return "RSASSA-PSS";
        ("1.2.840.113549.1.1.11"): return "sha256WithRSAEncryption";
        ("1.2.840.113549.1.1.12"): return "sha384WithRSAEncryption";
        ("1.2.840.113549.1.1.13"): return "sha512WithRSAEncryption";
        ("1.2.840.10045.2.1"): return "id-ecPublicKey";
        ("1.2.840.10045.3.1.7"): return "P-256";
        ("1.3.132.0.34"): return "P-384";
        ("1.3.132.0.35"): return "P-521";
        ("1.2.840.10045.4.3.2"): return "ecdsa-with-SHA256";
        ("1.2.840.10045.4.3.3"): return "ecdsa-with-SHA384";
        ("1.2.840.10045.4.3.4"): return "ecdsa-with-SHA512";
        ("1.3.101.112"): return "Ed25519";
        ("1.3.101.113"): return "Ed448";
        ("2.16.840.1.101.3.4.3.17"): return "ML-DSA-44";
        ("2.16.840.1.101.3.4.3.18"): return "ML-DSA-65";
        ("2.16.840.1.101.3.4.3.19"): return "ML-DSA-87";
        ("2.5.4.3"): return "commonName";
        ("2.5.4.6"): return "countryName";
        ("2.5.4.10"): return "organizationName";
        ("2.5.4.11"): return "organizationalUnitName";
        ("2.5.29.14"): return "subjectKeyIdentifier";
        ("2.5.29.15"): return "keyUsage";
        ("2.5.29.17"): return "subjectAltName";
        ("2.5.29.19"): return "basicConstraints";
        ("2.5.29.31"): return "cRLDistributionPoints";
        ("2.5.29.32"): return "certificatePolicies";
        ("2.5.29.35"): return "authorityKeyIdentifier";
        ("2.5.29.37"): return "extKeyUsage";
        ("1.3.6.1.5.5.7.1.1"): return "authorityInfoAccess";
        ("1.3.6.1.4.1.11129.2.4.2"): return "signedCertificateTimestampList";
        ("1.3.6.1.5.5.7.3.1"): return "serverAuth";
        ("1.3.6.1.5.5.7.3.2"): return "clientAuth";
        (_): return dotted;
    }
};
