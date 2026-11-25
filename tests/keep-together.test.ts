import { describe, expect, it } from "vitest";
import { keepWordsTogether } from "@/lib/export/keep-together";

// Show non-breaking spaces as "~" so expectations are readable.
const show = (s: string) => keepWordsTogether(s).replaceAll(" ", "~");

describe("keepWordsTogether", () => {
  it("glues single-letter words to the next word", () => {
    expect(show("It was a strong effect. A second study found I was wrong.")).toBe(
      "It was a~strong effect. A~second study found I~was wrong."
    );
    expect(show("(a small sample)")).toBe("(a~small sample)");
    expect(show("*A study* of **a dose**")).toBe("*A~study* of **a~dose**");
    expect(show("“A new view”")).toBe("“A~new view”");
  });

  it("leaves letters inside words, at the end of text, and other words alone", () => {
    expect(show("data and analysis, but also India")).toBe("data and analysis, but also India");
    expect(show("Chapter I")).toBe("Chapter I");
    expect(show("Phase B trial")).toBe("Phase B trial");
  });

  it("keeps citation pieces together but lets long citations break between authors", () => {
    expect(show("as shown (Darvish, Ludwig and Ikoba, 2024).")).toBe(
      "as shown (Darvish, Ludwig and Ikoba,~2024)."
    );
    expect(show("(Smith et al., 2020; Jones, 2019a)")).toBe("(Smith~et~al.,~2020; Jones,~2019a)");
    expect(show("(Mohabbat and Arazi 2024)")).toBe("(Mohabbat and Arazi~2024)");
    expect(show("(Okafor, n.d.)")).toBe("(Okafor,~n.d.)");
    expect(show("(Smith, 2020, p. 12; Lee, 2021, pp. 3–5)")).toBe(
      "(Smith,~2020, p.~12; Lee,~2021, pp.~3–5)"
    );
  });

  it("does not glue ordinary numbers that are not citation years", () => {
    expect(show("We enrolled 1, 20 and 300 rats over 12 weeks.")).toBe(
      "We enrolled 1, 20 and 300 rats over 12 weeks."
    );
    expect(show("between 2010 and 2020 the rate rose")).toBe("between 2010 and 2020 the rate rose");
  });

  it("is safe to run twice and leaves text without spaces untouched", () => {
    const once = keepWordsTogether("a test (Smith et al., 2020, p. 4)");
    expect(keepWordsTogether(once)).toBe(once);
    expect(keepWordsTogether("https://doi.org/10.1016/j.x.2024.1")).toBe(
      "https://doi.org/10.1016/j.x.2024.1"
    );
    expect(keepWordsTogether("")).toBe("");
  });
});
