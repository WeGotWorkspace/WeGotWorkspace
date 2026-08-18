import { LitElement, unsafeCSS } from "lit";
import style from "./styles.css?inline";

type PropertyDefinition = {
  observer?: (this: BaseElement, value: unknown) => void;
  dispatchChangeEvent?: { bubbles: boolean; composed: boolean };
  attribute?: string | boolean;
  [key: string]: unknown;
};

type PropertiesMap = Record<string, PropertyDefinition>;

interface BaseElementConstructor {
  properties?: PropertiesMap;
  observers?: Map<string, string[]>;
  new (): BaseElement;
}

export class BaseElement extends LitElement {
  static get styles() {
    return [unsafeCSS(style)];
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);

    changedProperties.forEach((_oldValue: unknown, key: string | number | symbol) => {
      const property = String(key);
      this.#callPropertyObservers(property);
      this.#callPropertyEventDispatchers(property);
    });
  }

  #callPropertyObservers(property: string) {
    const Constructor = this.constructor as BaseElementConstructor;

    Constructor.observers?.forEach((props: string[], methodName: string) => {
      if (props.includes(property)) {
        const method = (this as unknown as Record<string, () => void>)[methodName];
        method?.call(this);
      }
    });
  }

  #callPropertyEventDispatchers(property: string) {
    const Constructor = this.constructor as BaseElementConstructor;
    const propertyDefinition = Constructor.properties?.[property];
    const changeDispatcherCfg = propertyDefinition?.dispatchChangeEvent;
    if (!changeDispatcherCfg) return;

    const attributeOption = propertyDefinition?.attribute;
    const eventBaseName =
      attributeOption === false
        ? property
        : typeof attributeOption === "string"
          ? attributeOption
          : property.toLowerCase();

    this.#dispatchChangeEvent(
      eventBaseName,
      changeDispatcherCfg.bubbles,
      changeDispatcherCfg.composed,
    );
  }

  #dispatchChangeEvent(eventBaseName: string, bubbles: boolean, composed: boolean) {
    this.dispatchEvent(new CustomEvent(`${eventBaseName}-changed`, { bubbles, composed }));
  }
}
