import type { IRenderStatusService } from "ag-grid-community";
import { BeanStub } from "ag-grid-community";

export class RenderStatusService extends BeanStub implements IRenderStatusService {
  public postConstruct(): void {
    // Solid 2.0 renders headers and cells asynchronously (microtask batching), so to help improve
    // DX we automatically queue resize operations after grouping operations so devs can write code
    // like this and have it work without the need for a setTimeout.
    //  const onRowGroupOpened = (p) => {
    //     p.api.autoSizeColumns(['ag-Grid-AutoColumn']);
    //   };
    if (this.beans.colAutosize) {
      const queueResizeOperationsForTick = this.queueResizeOperationsForTick.bind(this);
      this.addManagedEventListeners({
        rowExpansionStateChanged: queueResizeOperationsForTick,
        expandOrCollapseAll: queueResizeOperationsForTick,
        // Enable devs to resize after they updated via the API
        cellValueChanged: queueResizeOperationsForTick,
        rowNodeDataChanged: queueResizeOperationsForTick,
        rowDataUpdated: queueResizeOperationsForTick,
      });
    }
  }

  // one pending drain at a time: cellValueChanged / rowNodeDataChanged fire ONCE PER ROW, so a
  // 500-row update transaction reached this method 501 times and scheduled 501 macrotasks
  // (the React wrapper does the same). The flag is set synchronously on every event, as
  // before; the drain runs once per macrotask turn, after Solid's microtask batch has
  // rendered the cells the queued autosize needs to measure.
  private drainScheduled = false;

  private queueResizeOperationsForTick() {
    const colAutosize = this.beans.colAutosize!;
    colAutosize.shouldQueueResizeOperations = true;
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      if (!this.isAlive()) {
        return;
      }
      colAutosize.processResizeOperations();
    }, 0);
  }

  public areHeaderCellsRendered(): boolean {
    return (
      this.beans.ctrlsSvc
        .getHeaderRowContainerCtrl()
        ?.getAllCtrls()
        .every((ctrl) => ctrl.areCellsRendered()) ?? true
    );
  }

  public areCellsRendered(): boolean {
    // Check that all rows ctrls have a gui
    // Check that all rendered rows that have cells have a GUI.
    // The guis are only set once Solid has actually rendered the row / cell via setComp()
    return this.beans.rowRenderer
      .getAllRowCtrls()
      .every(
        (row) => row.isRowRendered() && row.getAllCellCtrls().every((cellCtrl) => !!cellCtrl.eGui),
      );
  }
}
