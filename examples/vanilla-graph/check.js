const control = query('[aria-label="Select Release"]');
if (!control) throw new Error("missing release control");

control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const caption = await waitFor(
  () => query("figcaption")?.textContent?.startsWith("Release") && query("figcaption"),
  "caption did not update",
);

return { caption: caption.textContent.trim() };
