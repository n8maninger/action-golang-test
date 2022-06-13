export function atoiOrDefault(s, def = 0) {
	const n = parseInt(s, 10);

	if (!isFinite(n) || isNaN(n))
		return def;

	return n;
}

export function parseFloatOrDefault(s, def = 0) {
	const n = parseFloat(s);

	if (!isFinite(n) || isNaN(n))
		return def;

	return n;
}