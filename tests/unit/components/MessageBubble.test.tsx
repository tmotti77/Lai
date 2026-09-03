/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MessageBubble } from "@/components/chat/MessageBubble";

describe("MessageBubble markdown parsing", () => {
  it("should render plain link correctly", () => {
    const { container } = render(
      <MessageBubble role="assistant" text="Check out [this page](/recommendations)" />
    );
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe("this page");
    expect(link?.getAttribute("href")).toBe("/recommendations");
  });

  it("should render bold text correctly", () => {
    const { container } = render(
      <MessageBubble role="assistant" text="This is **bold text** here" />
    );
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("bold text");
  });

  it("should render bold link without extra asterisks", () => {
    const { container } = render(
      <MessageBubble role="assistant" text="Visit **[recommendations](/recommendations)** now" />
    );
    
    // Should render a link without the bold wrapper
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe("recommendations");
    expect(link?.getAttribute("href")).toBe("/recommendations");
    
    // Should NOT show literal asterisks
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("[");
    expect(container.textContent).not.toContain("]");
  });

  it("should handle mixed markdown patterns", () => {
    const { container } = render(
      <MessageBubble 
        role="assistant" 
        text="You can **start now** or visit **[recommendations](/recommendations)** for more" 
      />
    );
    
    const strong = container.querySelector("strong");
    const link = container.querySelector("a");
    
    expect(strong?.textContent).toBe("start now");
    expect(link?.textContent).toBe("recommendations");
    expect(link?.getAttribute("href")).toBe("/recommendations");
    
    // Check the full text flow
    expect(container.textContent).toContain("You can start now or visit recommendations for more");
  });

  it("should handle text with no markdown", () => {
    const { container } = render(
      <MessageBubble role="assistant" text="Plain text message" />
    );
    expect(container.textContent).toBe("Plain text message");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });
});
