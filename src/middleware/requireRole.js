import { forbidden } from "../utils/errors.js";

export default function requireRole(...roles) {
    return (req, res, next) => {
        const r = req.user?.role;
        if (!r || !roles.includes(r)) {
            return next(forbidden());
        }
        next();
    };
};
