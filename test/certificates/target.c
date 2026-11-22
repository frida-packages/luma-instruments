#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#ifdef __APPLE__
# include <Security/Security.h>
#endif

typedef struct {
    EVP_PKEY *key;
    X509 *cert;
} Identity;

static EVP_PKEY *make_key(int type, int parameter);
static X509 *make_certificate(const char *common_name, EVP_PKEY *key, const Identity *issuer, const EVP_MD *md,
        const char *alt_names, int is_ca);
static void describe(const char *holder, X509 *cert);
static X509 *decoded_copy_of(X509 *cert);
#ifdef __APPLE__
static SecCertificateRef security_framework_copy_of(X509 *cert);
#endif
static unsigned char *der_copy_of(X509 *cert);
static char *pem_of(X509 *cert);
static void add_extension(X509 *cert, X509 *issuer, int nid, const char *value);
static unsigned char *encode(X509 *cert, int *length);
static void describe_encoding(const char *holder, X509 *cert, const unsigned char *der, int length);
static void wipe_and_free(unsigned char *der, int length);

static void *kept[16];
static int n_kept = 0;

int main(void)
{
    Identity root, ec_ca;
    X509 *cert;

    root.key = make_key(EVP_PKEY_RSA, 2048);
    root.cert = make_certificate("Certificates Test Root", root.key, NULL, EVP_sha256(), NULL, 1);
    describe("generated X509 only", root.cert);

    ec_ca.key = make_key(EVP_PKEY_EC, NID_secp384r1);
    ec_ca.cert = make_certificate("Certificates Test EC CA", ec_ca.key, &root, EVP_sha256(), NULL, 1);
    X509_up_ref(ec_ca.cert);
    kept[n_kept++] = decoded_copy_of(ec_ca.cert);

    kept[n_kept++] = decoded_copy_of(make_certificate("openssl-rsa-signed.test", make_key(EVP_PKEY_EC, NID_X9_62_prime256v1), &root,
            EVP_sha256(), "DNS:openssl-rsa-signed.test,DNS:*.openssl.test,IP:10.0.0.1", 0));
    kept[n_kept++] = decoded_copy_of(make_certificate("openssl-ecdsa-signed.test", make_key(EVP_PKEY_EC, NID_X9_62_prime256v1), &ec_ca,
            EVP_sha384(), "DNS:openssl-ecdsa-signed.test", 0));
    kept[n_kept++] = decoded_copy_of(make_certificate("openssl-ed25519.test", make_key(EVP_PKEY_ED25519, 0), NULL, NULL,
            "DNS:openssl-ed25519.test", 0));

#ifdef __APPLE__
    kept[n_kept++] = security_framework_copy_of(make_certificate("security-framework.test", make_key(EVP_PKEY_EC, NID_X9_62_prime256v1),
            &root, EVP_sha256(), "DNS:security-framework.test,email:admin@security-framework.test", 0));
#endif

    kept[n_kept++] = der_copy_of(make_certificate("raw-der.test", make_key(EVP_PKEY_ED25519, 0), NULL, NULL, NULL, 0));

    cert = make_certificate("pem.test", make_key(EVP_PKEY_EC, NID_X9_62_prime256v1), &root, EVP_sha256(),
            "DNS:pem.test,URI:https://pem.test/", 0);
    describe("PEM buffer", cert);
    kept[n_kept++] = pem_of(cert);
    X509_free(cert);

    printf("ready, pid %d, %s\n", getpid(), OpenSSL_version(OPENSSL_VERSION));
    fflush(stdout);

    pause();

    return 0;
}

static EVP_PKEY *make_key(int type, int parameter)
{
    EVP_PKEY_CTX *ctx;
    EVP_PKEY *key = NULL;

    ctx = EVP_PKEY_CTX_new_id(type, NULL);
    EVP_PKEY_keygen_init(ctx);
    if (type == EVP_PKEY_RSA)
        EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, parameter);
    else if (type == EVP_PKEY_EC)
        EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx, parameter);
    EVP_PKEY_keygen(ctx, &key);
    EVP_PKEY_CTX_free(ctx);

    return key;
}

static X509 *make_certificate(const char *common_name, EVP_PKEY *key, const Identity *issuer, const EVP_MD *md, const char *alt_names,
        int is_ca)
{
    X509 *cert;
    X509 *issuer_cert;
    X509_NAME *subject;
    static long serial = 0x1000;

    cert = X509_new();
    issuer_cert = (issuer != NULL) ? issuer->cert : cert;
    X509_set_version(cert, 2);
    ASN1_INTEGER_set(X509_get_serialNumber(cert), serial++);
    X509_gmtime_adj(X509_getm_notBefore(cert), -3600);
    X509_gmtime_adj(X509_getm_notAfter(cert), is_ca ? 10L * 365 * 86400 : 90L * 86400);
    subject = X509_NAME_new();
    X509_NAME_add_entry_by_txt(subject, "C", MBSTRING_ASC, (const unsigned char *) "NO", -1, -1, 0);
    X509_NAME_add_entry_by_txt(subject, "O", MBSTRING_ASC, (const unsigned char *) "Frida Test", -1, -1, 0);
    X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_UTF8, (const unsigned char *) common_name, -1, -1, 0);
    X509_set_subject_name(cert, subject);
    X509_NAME_free(subject);
    X509_set_issuer_name(cert, X509_get_subject_name(issuer_cert));
    X509_set_pubkey(cert, key);

    add_extension(cert, issuer_cert, NID_basic_constraints, is_ca ? "critical,CA:TRUE" : "CA:FALSE");
    add_extension(cert, issuer_cert, NID_key_usage, is_ca ? "critical,keyCertSign,cRLSign" : "critical,digitalSignature");
    if (alt_names != NULL) {
        add_extension(cert, issuer_cert, NID_subject_alt_name, alt_names);
        add_extension(cert, issuer_cert, NID_ext_key_usage, "serverAuth,clientAuth");
    }

    X509_sign(cert, (issuer != NULL) ? issuer->key : key, md);

    return cert;
}

static void describe(const char *holder, X509 *cert)
{
    unsigned char *der;
    int length;

    der = encode(cert, &length);
    describe_encoding(holder, cert, der, length);
    wipe_and_free(der, length);
}

static X509 *decoded_copy_of(X509 *cert)
{
    unsigned char *der;
    const unsigned char *cursor;
    int length;
    X509 *copy;

    der = encode(cert, &length);
    describe_encoding("decoded OpenSSL X509", cert, der, length);
    cursor = der;
    copy = d2i_X509(NULL, &cursor, length);
    wipe_and_free(der, length);
    X509_free(cert);

    return copy;
}

#ifdef __APPLE__

static SecCertificateRef security_framework_copy_of(X509 *cert)
{
    unsigned char *der;
    int length;
    CFDataRef data;
    SecCertificateRef copy;

    der = encode(cert, &length);
    describe_encoding("SecCertificate", cert, der, length);
    data = CFDataCreate(NULL, der, length);
    copy = SecCertificateCreateWithData(NULL, data);
    CFRelease(data);
    wipe_and_free(der, length);
    X509_free(cert);

    return copy;
}

#endif

static unsigned char *der_copy_of(X509 *cert)
{
    unsigned char *der, *copy;
    int length;

    der = encode(cert, &length);
    describe_encoding("raw DER buffer", cert, der, length);
    copy = malloc(length);
    memcpy(copy, der, length);
    wipe_and_free(der, length);
    X509_free(cert);

    return copy;
}

static char *pem_of(X509 *cert)
{
    BIO *bio;
    char *data, *pem;
    long length;

    bio = BIO_new(BIO_s_mem());
    PEM_write_bio_X509(bio, cert);
    length = BIO_get_mem_data(bio, &data);
    pem = malloc(length + 1);
    memcpy(pem, data, length);
    pem[length] = '\0';
    OPENSSL_cleanse(data, length);
    BIO_free(bio);

    return pem;
}

static void add_extension(X509 *cert, X509 *issuer, int nid, const char *value)
{
    X509V3_CTX ctx;
    X509_EXTENSION *extension;

    X509V3_set_ctx(&ctx, issuer, cert, NULL, NULL, 0);
    extension = X509V3_EXT_conf_nid(NULL, &ctx, nid, (char *) value);
    X509_add_ext(cert, extension, -1);
    X509_EXTENSION_free(extension);
}

static unsigned char *encode(X509 *cert, int *length)
{
    unsigned char *der = NULL;

    *length = i2d_X509(cert, &der);

    return der;
}

static void describe_encoding(const char *holder, X509 *cert, const unsigned char *der, int length)
{
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int digest_length, i;
    char name[256];

    EVP_Digest(der, length, digest, &digest_length, EVP_sha256(), NULL);
    X509_NAME_oneline(X509_get_subject_name(cert), name, sizeof(name));

    printf("%-22s %-56s ", holder, name);
    for (i = 0; i != digest_length; i++)
        printf("%02x", digest[i]);
    printf("\n");
}

static void wipe_and_free(unsigned char *der, int length)
{
    OPENSSL_cleanse(der, length);
    OPENSSL_free(der);
}
