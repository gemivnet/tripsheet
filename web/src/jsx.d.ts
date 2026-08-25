// React 19's types removed the global `JSX` namespace in favour of `React.JSX`, but this
// codebase annotates with bare `JSX.Element` in ~20 files. esbuild strips types without
// checking them, so nothing noticed until tsconfig.web.json started type-checking web/.
//
// This restores the global alias rather than rewriting every annotation. Delete it if the
// components are ever migrated to `React.JSX.Element`.
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementType = ReactJSX.ElementType;
    type ElementClass = ReactJSX.ElementClass;
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
  }
}
