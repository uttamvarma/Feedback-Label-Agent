import config from "./config.js";

const THEME_DEFINITIONS = {
  "Functionality": "Feedback where the user requests new or enhanced capabilities not currently available. Includes requests for new modules, integrations, or improvements to existing features (e.g. 'Inquiring about how to bulk export reports' from Report Configuration, 'Customer looking for help on how to export data' from Data Export).",
  "Workflow": "Feedback highlighting cumbersome or manual processes within the product flow. Includes complaints about excessive steps, navigation issues, or lack of automation (e.g. 'Questions around adding users and patients to projects' from Project Management, 'Customer had questions about steps merging patient files' from Patient or Employee Management).",
  "Stability": "Feedback related to product reliability and performance issues. Includes crashes, freezes, latency, errors, or timeouts affecting usability (e.g. 'User unable to log in to iPad despite changing password' from Login issues, 'Customer getting a server error when accessing portal' from Portal Downtime).",
  "Guidance": "Feedback expressing the need for clearer documentation, training materials, or support assistance. Includes requests for setup instructions, tutorials, tooltips, or faster support response (e.g. 'Verification email link has expired; request for a new link' from Resend Verification Email, 'Customer states they are unsure of the password reset process' from Password reset).",
  "Provisioning": "Feedback concerning account setup, licensing, seat management, or entitlement issues. Includes requests to add/remove licenses, manage permissions, or upgrade capacity (e.g. 'User access update request: needed admin access' from Account and License Handling, 'Affiliate requesting to reactivate demo account' from Portal Provisioning).",
  "Compliance": "Feedback involving regulatory, legal, or policy requirements. Includes questions about certifications, data privacy, security standards, or audit logs (e.g. no direct examples from this dataset; typical cases include 'Is this FDA-cleared?')."
};

const IMPACT_DEFINITIONS = {
  "High": "Affects patient safety or a large user base; requires urgent attention.",
  "Medium": "Disruptive but there are workarounds or limited user scope.",
  "Low": "Minor annoyance, cosmetic issue, or nice-to-have enhancement."
};

/**
 * Build an instruction prompt for Atlassian Intelligence.
 * @param {string} subject - The feedback subject
 * @param {string} description - The feedback description
 * @returns {string} The formatted prompt
 */
export function generateLabelsPrompt(subject, description) {
  const themeList = config.labelTaxonomy.themes
    .map((theme) => `  - ${theme}: ${THEME_DEFINITIONS[theme] || ""}`)
    .join("\n");

  const impactList = config.labelTaxonomy.impactLevels
    .map((impact) => `  - ${impact}: ${IMPACT_DEFINITIONS[impact] || ""}`)
    .join("\n");

  // Sanitize inputs to prevent prompt injection
  const sanitizedSubject = (subject || "").replace(/[{}]/g, "").trim();
  const sanitizedDescription = (description || "").replace(/[{}]/g, "").trim();

  return `You are a Feedback Classification Assistant for a regulated medical device company.

Your task is to analyze feedback and classify it with exactly one Theme and one Impact level.

THEMES (choose exactly one):
${themeList}

IMPACT LEVELS (choose exactly one):
${impactList}

IMPORTANT INSTRUCTIONS:
1. Return your response as valid JSON only
2. Use the exact label names as provided above
3. Include a confidence score between 0.0 and 1.0
4. Do not add any explanation or additional text

FEEDBACK TO CLASSIFY:
Subject: ${sanitizedSubject}
Description: ${sanitizedDescription}

Required JSON format:
{"Theme":"<exact_theme_name>","Impact":"<exact_impact_level>","confidence":<number>}`;
}