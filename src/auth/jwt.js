const jwt = require("jsonwebtoken");

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "emlakskor_token";

function cookieName() {
    return COOKIE_NAME;
}

function signToken(payload, opts = {}) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("Missing JWT_SECRET");

    const expiresIn = opts.expiresIn || "7d";
    return jwt.sign(payload, secret, { expiresIn });
}

function verifyToken(token) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("Missing JWT_SECRET");
    return jwt.verify(token, secret);
}

module.exports = { cookieName, signToken, verifyToken };
