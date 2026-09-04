const heading = query("h1");
const button = query("button[data-increment]");
if (!heading || heading.textContent?.trim() !== "Interactive counter") throw new Error("missing semantic heading");
if (!(button instanceof HTMLButtonElement)) throw new Error("missing increment button");

button.click();
const output = await waitFor(() => query('output[data-count="1"]'), "counter did not update");
if (!(output instanceof HTMLOutputElement) || output.textContent?.trim() !== "1") throw new Error("invalid counter output");

return { heading: heading.textContent.trim(), count: Number(output.value) };
