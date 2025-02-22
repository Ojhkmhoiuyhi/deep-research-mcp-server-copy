export function extractJsonFromText(text: string): any | null {
  if (!text) {
    return null; // Handle empty input text
  }
  try {
    // Regex to extract JSON object (using non-greedy match and allowing for whitespace)
    const jsonRegex = /\{[\s\S]*?\}/; // Non-greedy match for JSON object
    const match = text.match(jsonRegex);

    if (match && match[0]) {
      const jsonString = match[0];
      try {
        return JSON.parse(jsonString); // Attempt to parse the extracted string as JSON
      } catch (jsonParseError) {
        console.error("Error parsing JSON string:", jsonParseError);
        return null; // Return null if JSON parsing fails
      }
    } else {
      console.warn("No JSON object found in text using regex.");
      return null; // Return null if no JSON object is found
    }
  } catch (regexError) {
    console.error("Regex error during JSON extraction:", regexError);
    return null; // Return null if regex matching fails
  }
}

export function isValidJSON(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true; // Parsing succeeded, it's valid JSON
  } catch {
    return false; // Parsing failed, it's not valid JSON
  }
}

export function safeParseJSON<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString) as T; // Attempt to parse and cast to type T
  } catch {
    return defaultValue; // Return defaultValue if parsing fails
  }
}

export function stringifyJSON(jsonObject: any, prettyPrint: boolean = false): string | null {
  try {
    if (prettyPrint) {
      return JSON.stringify(jsonObject, null, 2); // Pretty print with indentation of 2 spaces
    } else {
      return JSON.stringify(jsonObject);
    }
  } catch {
    return null; // Return null if stringification fails
  }
}
