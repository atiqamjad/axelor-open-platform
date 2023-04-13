import { atom, useAtomValue, useSetAtom } from "jotai";
import { focusAtom } from "jotai-optics";
import { useEffect, useMemo } from "react";

import { useViewDirtyAtom } from "@/view-containers/views/scope";
import { createWidgetAtom } from "./atoms";
import { FieldEditor } from "./form-editors";
import { useWidgetComp } from "./hooks";
import { useFormScope } from "./scope";
import { WidgetAtom, WidgetProps } from "./types";
import { parseExpression } from "@/hooks/use-parser/utils";
import { Schema } from "@/services/client/meta.types";

export function FormWidget(props: Omit<WidgetProps, "widgetAtom">) {
  const { schema, formAtom, readonly } = props;

  const widgetAtom = useMemo(
    () => createWidgetAtom({ schema, formAtom }),
    [formAtom, schema]
  );

  const type = schema.type;
  const { attrs } = useAtomValue(widgetAtom);
  const { state, data: Comp } = useWidgetComp(schema);

  // eval field expression showIf, hideIf etc
  useHandleFieldExpression({ schema, widgetAtom });

  if (attrs.hidden) return null;
  if (state === "loading") {
    return <div>Loading...</div>;
  }

  const widgetProps = {
    schema,
    formAtom,
    widgetAtom,
    readonly: readonly || attrs.readonly,
  };

  if (Comp) {
    return ["field", "panel-related"].includes(type!) ? (
      <FormField component={Comp} {...widgetProps} />
    ) : (
      <Comp {...widgetProps} />
    );
  }
  return <Unknown {...widgetProps} />;
}

function FormField({
  component: Comp,
  ...props
}: WidgetProps & { component: React.ElementType }) {
  const { schema, formAtom, readonly } = props;
  const name = schema.name!;
  const onChange = schema.onChange;
  const dirtyAtom = useViewDirtyAtom();
  const setDirty = useSetAtom(dirtyAtom);

  const { actionExecutor } = useFormScope();

  const valueAtom = useMemo(() => {
    const lensAtom = focusAtom(formAtom, (o) => o.prop("record").prop(name));
    return atom(
      (get) => get(lensAtom),
      (get, set, value: any, fireOnChange: boolean = false) => {
        const prev = get(lensAtom);
        if (prev !== value) {
          set(lensAtom, value);
          set(formAtom, (prev) => ({ ...prev, dirty: true }));
          setDirty(true);
        }
        if (onChange && fireOnChange) {
          actionExecutor.execute(onChange, {
            context: {
              _source: name,
            },
          });
        }
      }
    );
  }, [actionExecutor, formAtom, name, onChange, setDirty]);

  if (schema.editor && !readonly) {
    return <FieldEditor {...props} valueAtom={valueAtom} />;
  }

  return <Comp {...props} valueAtom={valueAtom} />;
}

function useHandleFieldExpression({
  schema,
  widgetAtom,
}: {
  schema: Schema;
  widgetAtom: WidgetAtom;
}) {
  const setWidgetAttrs = useSetAtom(widgetAtom);
  const { recordHandler } = useFormScope();

  useEffect(() => {
    const { showIf, hideIf, readonlyIf, requiredIf } = schema;
    const hasExpression = showIf || hideIf || readonlyIf || requiredIf;

    if (hasExpression) {
      return recordHandler.subscribe((record) => {
        setWidgetAttrs((state) => {
          const { attrs } = state;

          let { hidden, readonly, required } = attrs;

          if (showIf) {
            hidden = !parseExpression(showIf)(record);
          } else if (hideIf) {
            hidden = parseExpression(hideIf)(record);
          }

          if (readonlyIf) {
            readonly = parseExpression(readonlyIf)(record);
          }

          if (requiredIf) {
            required = parseExpression(requiredIf)(record);
          }

          if (
            attrs.hidden !== hidden ||
            attrs.required !== required ||
            attrs.readonly !== readonly
          ) {
            return {
              ...state,
              attrs: { ...attrs, required, hidden, readonly },
            };
          }

          return state;
        });
      });
    }
  }, [schema, recordHandler, setWidgetAttrs]);
}

function Unknown(props: WidgetProps) {
  const { schema } = props;
  return <div>{schema.widget}</div>;
}
