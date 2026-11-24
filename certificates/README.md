# Certificates

Finds the X.509 certificates a process holds in memory and lists each one
once, with every place it was found: live certificate objects first, which
takes milliseconds, then DER and PEM encodings anywhere in memory.

## How it finds them

Live objects are found with a pointer search over writable memory:

- **SecCertificate** on macOS and iOS. Core Foundation objects begin with an
  isa word, and certificates share theirs, `__NSCFType`, with the other
  Core Foundation types that have no class of their own, so the search is for
  that class under the runtime's isa mask. Before anything is called on a
  hit, it has to be 16-byte aligned and the start of a live heap block of at
  least 128 bytes, according to `malloc_size`; only then is `CFGetTypeID`
  asked whether it is a certificate, and only a certificate is asked for its
  bytes, which have to parse.
- **OpenSSL X509**, from OpenSSL 1.1.1 to 4.x, loaded as a library or
  exported from the program itself. When OpenSSL decodes a certificate, both
  of its signature algorithm fields point at the library's shared object for
  that algorithm, the one `OBJ_nid2obj` returns, a fixed distance apart. The
  search is for pointers to those objects, and only pairs at that distance
  are looked at. Nothing in the library is called on them: the certificate is
  put back together from what the X509 holds, the encoding of its signed part
  that OpenSSL keeps from decoding, and its signature. It has to parse, and
  name the algorithm that was pointed at.

Then readable memory is scanned for encodings, 16 MiB at a time:

- **DER**: the start of a version 3 certificate, `a0 03 02 01 02 02` after
  two SEQUENCE headers.
- **PEM**: `-----BEGIN CERTIFICATE-----`, and the `X509 CERTIFICATE` and
  `TRUSTED CERTIFICATE` forms.

A certificate is identified by the SHA-256 of its DER, so one seen several
ways, or in several copies, is one row.

## What it shows

- A status line at the top: progress while scanning; afterwards, how many
  certificates there are and how long the object search and the memory scan
  took.
- **Certificates**: a row per certificate, with the common name of its
  subject and issuer (or the organization, or the whole name), when it
  expires, its key, the start of its SHA-256 fingerprint, and how it was
  found, such as `SecCertificate ×2, DER ×5`. **Rescan**, in its header,
  scans again: certificates no longer found are dropped, and the others keep
  their rows. It is disabled while a scan is under way.
- **Inspect** on a row shows the certificate in **Details** as a value you
  can expand: subject, issuer, serial number, validity, signature algorithm,
  key, subject alternative names, basic constraints, key usage, extended key
  usage, both fingerprints, every place it was found, its PEM, and its DER.
  It also puts the DER in the **DER** view, at the address it was found,
  when it was found whole in memory.
- **Details** takes a name, host name or fingerprint prefix and shows the
  certificates that match. After each scan it gets a summary: how many
  certificates each strategy found, how many candidates the pointer search
  turned up and how long finding and checking them took, and how long the
  memory scan took. **Clear** empties it.

Each certificate is also an event the first time it is found, carrying
`subject`, `issuer`, `notAfter`, `sha256`, `foundBy`, `address` and `der`.

The instrument comes with `x509.hexpat`, a pattern for the DER view or a
`der` field: it names the parts of the certificate and shows its names,
times and object identifiers as text.

## Settings

- **Memory to scan for encoded certificates**: writable memory, the default,
  or all readable memory, which adds code, constants and mapped files. Those
  add the certificates programs and libraries carry, and take far longer:
  macOS's shared cache alone is several gigabytes. The object search always
  covers writable memory. Changing this starts a new scan.

## Speed

On an Apple Silicon Mac, in Chrome's browser process, the object search took
25 ms, and 782 MiB of writable memory was scanned in 0.6 s; all 7.6 GiB of
readable memory took 6.3 s. In a Python process that had loaded 181 root
certificates into OpenSSL, the object search found all 181 in 63 ms.

## What it does not find

- **OpenSSL certificates built in the process** rather than decoded, such as
  one made with `X509_new` and `X509_sign`, or changed after decoding:
  OpenSSL then marks the encoding it keeps as stale. Serializing those would
  mean calling `i2d_X509` on memory that is only believed to be an X509. Once
  the program serializes one, the DER scan finds it.
- **Other X509 layouts**: OpenSSL before 1.1.1, LibreSSL (Apple's
  `/usr/lib/libcrypto`) and BoringSSL. BoringSSL keeps the DER of every
  certificate it parses, so the DER scan finds those, as it does in Chrome.
- **Windows `CERT_CONTEXT`**: there is no object search for it. Its encoded
  certificate is in memory, where the DER scan should find it, but this has
  not been tried.
- **SecCertificate objects made with a custom allocator**, which do not start
  a heap block.
- **Version 1 and 2 certificates, certificates over 64 KiB, and PEM stored as
  UTF-16**, which the memory scan does not look for.
- **Certificates that come and go during a scan.** A scan is a snapshot: what
  is freed or reused between the object search and the memory scan, or while
  the scan goes on, may be missed, or found where it no longer is.

## Safety

Reading memory leaves the process as it was: unreadable memory is skipped,
and a candidate that does not check out is dropped. The only calls made into
the process on a candidate are `malloc_size`, which takes any pointer, on
aligned ones; `CFGetTypeID` on those that start a live heap block and begin
with the isa of a Core Foundation object; and the two `SecCertificate`
getters on objects confirmed to be certificates. Another thread could still
release such an object between the check and the call.

It was tested on macOS 27 on Apple Silicon, with OpenSSL 1.1.1, 3.6 and 4.1,
Security.framework, Chrome and Python. Linux, Windows and iOS have not been
tried.
