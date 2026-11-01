/**
 * Converts a string into a URL-safe lowercase slug.
 *
 * @param {string} text - The input string
 * @returns {string} URL-safe slug
 */
export function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s\W-]+/g, "-") // Replace spaces and non-word characters with dashes
        .replace(/^-+|-+$/g, "");   // Remove leading/trailing dashes
}

