import type {
  BaseCellEditor,
  BaseDate,
  BaseDateParams,
  BaseFilter,
  BaseFilterParams,
  BaseFloatingFilter,
  BaseMenuItem,
  BaseMenuItemParams,
  BaseToolPanelParams,
  FilterDisplayParams,
  FloatingFilterDisplayParams,
  ICellEditorParams,
  ICellRendererParams,
  IDetailCellRendererParams,
  IDragAndDropImageParams,
  IExportingOverlayParams,
  IFilter,
  IFloatingFilterParams,
  IGroupCellRendererParams,
  IHeaderGroupParams,
  IHeaderParams,
  ILoadingCellRendererParams,
  ILoadingOverlayParams,
  INoMatchingRowsOverlayParams,
  INoRowsOverlayParams,
  IOverlayParams,
  IStatusPanelParams,
  ITooltipParams,
  SharedFilterUi,
} from "ag-grid-community";

// Port of React's shared/customComp/interfaces.ts (types only — the public hooks live in
// hooks.ts). §5.0: `type` aliases instead of `interface extends`; wrapper-added fields are
// `readonly` (they are pushed by the wrappers, never mutated by user components).

// *** Props ***

/** Props provided to custom cell editor components */
export type CustomCellEditorProps<TData = any, TValue = any, TContext = any> = ICellEditorParams<
  TData,
  TValue,
  TContext
> & {
  /** The value in the cell when editing started. */
  readonly initialValue: TValue | null | undefined;
  /** The current value for the editor. */
  readonly value: TValue | null | undefined;
  /** Callback that should be called every time the value in the editor changes. */
  readonly onValueChange: (value: TValue | null | undefined) => void;
};

/** Props provided to custom date components */
export type CustomDateProps<TData = any, TContext = any> = BaseDateParams<TData, TContext> & {
  /** The current date for the component. */
  readonly date: Date | null;
  /** Callback that should be called every time the date in the component changes. */
  readonly onDateChange: (date: Date | null) => void;
};

/** Props provided to custom filter components */
export type CustomFilterProps<TData = any, TContext = any, TModel = any> = BaseFilterParams<
  TData,
  TContext
> & {
  /** The current filter model for the component. */
  readonly model: TModel | null;
  /** Callback that should be called every time the model in the component changes. */
  readonly onModelChange: (model: TModel | null) => void;
  /**
   * Callback that can be optionally called every time the filter UI changes.
   * The grid will respond with emitting a FilterModifiedEvent.
   * Apart from emitting the event, the grid takes no further action.
   */
  readonly onUiChange: () => void;
};

/** Props provided to custom filter components when `enableFilterHandlers = true` */
export type CustomFilterDisplayProps<
  TData = any,
  TContext = any,
  TModel = any,
> = FilterDisplayParams<TData, TContext, TModel>;

/** Props provided to custom floating filter components */
export type CustomFloatingFilterProps<
  P = IFilter,
  TData = any,
  TContext = any,
  TModel = any,
> = IFloatingFilterParams<P, TData, TContext> & {
  /** The current filter model for the component. */
  readonly model: TModel | null;
  /** Callback that should be called every time the model in the component changes. */
  readonly onModelChange: (model: TModel | null) => void;
};

/** Props provided to custom floating filter components when `enableFilterHandlers = true` */
export type CustomFloatingFilterDisplayProps<
  TData = any,
  TContext = any,
  TModel = any,
  TCustomParams = object,
> = FloatingFilterDisplayParams<TData, TContext, TModel, TCustomParams>;

/** Props provided to custom tool panel components */
export type CustomToolPanelProps<TData = any, TContext = any, TState = any> = BaseToolPanelParams<
  TData,
  TContext,
  TState
> & {
  /**
   * The current state for the component (used in grid state).
   * Initially set to the same value as `initialState`
   */
  readonly state: TState | undefined;
  /**
   * If using grid state, callback that should be called every time the state in the component changes.
   * If not using grid state, not required.
   */
  readonly onStateChange: (model: TState | undefined) => void;
};

/** Props provided to custom menu item components */
export type CustomMenuItemProps<TData = any, TContext = any> = BaseMenuItemParams<
  TData,
  TContext
> & {
  /** The active status of the item (is it currently hovered with the mouse, or navigated to via the keyboard). */
  readonly active: boolean;
  /** If the item is a sub menu, whether it is currently opened or closed. */
  readonly expanded: boolean;
  /** Callback that should be called every time the active status is updated (if providing custom behaviour). */
  readonly onActiveChange: (active: boolean) => void;
};

/** Props provided to custom Drag and Drop Image components */
export type CustomDragAndDropImageProps<TData = any, TContext = any> = IDragAndDropImageParams<
  TData,
  TContext
> & {
  /** The label provided by the grid about the item being dragged. */
  readonly label: string;
  /** The name of the icon provided by the grid about the current drop target. */
  readonly icon: string | null;
  /** `true` if the grid is attempting to scroll horizontally while dragging. */
  readonly shake: boolean;
};

export type CustomInnerHeaderProps<TData = any, TContext = any> = IHeaderParams<TData, TContext>;
export type CustomInnerHeaderGroupProps<TData = any, TContext = any> = IHeaderGroupParams<
  TData,
  TContext
>;

/** Props provided to custom overlay components */
export type CustomOverlayProps<TData = any, TContext = any> = IOverlayParams<TData, TContext>;

/** Props provided to custom loading overlay component */
export type CustomLoadingOverlayProps<TData = any, TContext = any> = ILoadingOverlayParams<
  TData,
  TContext
>;

/** Props provided to custom exporting overlay component */
export type CustomExportingOverlayProps<TData = any, TContext = any> = IExportingOverlayParams<
  TData,
  TContext
>;

/** Props provided to custom no-rows overlay component */
export type CustomNoRowsOverlayProps<TData = any, TContext = any> = INoRowsOverlayParams<
  TData,
  TContext
>;

/** Props provided to custom no-matching-rows overlay component */
export type CustomNoMatchingRowsOverlayProps<
  TData = any,
  TContext = any,
> = INoMatchingRowsOverlayParams<TData, TContext>;

/** Props provided to custom status panel components */
export type CustomStatusPanelProps<TData = any, TContext = any> = IStatusPanelParams<
  TData,
  TContext
>;

/** Props provided to custom cell renderer components */
export type CustomCellRendererProps<
  TData = any,
  TValue = any,
  TContext = any,
> = ICellRendererParams<TData, TValue, TContext>;

/** Props provided to custom detail cell renderer components */
export type CustomDetailCellRendererProps<TData = any, TDetail = any> = IDetailCellRendererParams<
  TData,
  TDetail
>;

/** Props provided to custom group cell renderer components */
export type CustomGroupCellRendererProps<TData = any, TValue = any> = IGroupCellRendererParams<
  TData,
  TValue
>;

/** Props provided to custom header components */
export type CustomHeaderProps<TData = any, TContext = any> = IHeaderParams<TData, TContext>;

/** Props provided to custom header group components */
export type CustomHeaderGroupProps<TData = any, TContext = any> = IHeaderGroupParams<
  TData,
  TContext
>;

/** Props provided to custom loading cell renderer components */
export type CustomLoadingCellRendererProps<
  TData = any,
  TContext = any,
> = ILoadingCellRendererParams<TData, TContext>;

/** Props provided to custom tooltip components */
export type CustomTooltipProps<TData = any, TValue = any, TContext = any> = ITooltipParams<
  TData,
  TValue,
  TContext
>;

// *** Callbacks ***

/** Callbacks for custom cell editor components */
export type CustomCellEditorCallbacks = BaseCellEditor;

/** Callbacks for custom date components */
export type CustomDateCallbacks = BaseDate;

/** Callbacks for custom filter components */
export type CustomFilterCallbacks = BaseFilter;

/** Callbacks for custom filter components when using `enableFilterHandlers = true` */
export type CustomFilterDisplayCallbacks = SharedFilterUi;

/** Callbacks for custom floating filter components */
export type CustomFloatingFilterCallbacks = BaseFloatingFilter;

/** Callbacks for custom menu item components */
export type CustomMenuItemCallbacks = BaseMenuItem;
