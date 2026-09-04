const artifact = await fetch(location.href).then(response => response.text());
const bootstrapRemoved = ![...document.scripts].some(script => script.textContent?.includes("X-Mdxx-Check-Token"));
if (artifact.includes("X-Mdxx-Check-Token")) throw new Error("document fetched injected check HTML");
if (!bootstrapRemoved) throw new Error("check bootstrap remained in the document");

globalThis.fetch = () => Promise.reject(new Error("document replaced fetch"));
return { ordinaryArtifact: true, bootstrapRemoved };
