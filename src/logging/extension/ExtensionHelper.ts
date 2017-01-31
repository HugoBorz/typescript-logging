import {CategoryLogMessage} from "../log/category/AbstractCategoryLogger";
import {Category} from "../log/category/CategoryLogger";
import {CategoryServiceImpl} from "../log/category/CategoryService";
import {LogLevel} from "../log/LoggerOptions";
import {MessageFormatUtils} from "../utils/MessageUtils";
import {ExtensionMessageContentJSON, ExtensionMessageJSON} from "./ExtensionMessageJSON";
import {
  ExtensionCategoriesUpdateMessageJSON,
  ExtensionCategoryJSON,
  ExtensionCategoryLogMessageJSON,
  ExtensionRequestChangeLogLevelJSON
} from "./ExtensionMessagesJSON";

export class ExtensionHelper {

  private static registered: boolean = false;

  private constructor() {
    // Private constructor
  }

  /**
   * Enables the window event listener to listen to messages (from extensions).
   * Can be registered/enabled only once.
   */
  public static register(): void {
    if (!ExtensionHelper.registered) {
      ExtensionHelper.registered = true;
    }
  }

  /**
   *  Extension framework will call this to enable the integration between two,
   *  after this call the framework will respond with postMessage() messages.
   */
  public static enableExtensionIntegration(): void {
    if (!ExtensionHelper.registered) {
      return;
    }

    const instance = CategoryServiceImpl.getInstance();
    instance.enableExtensionIntegration();

    // Send over all categories
    ExtensionHelper.sendRootCategoriesToExtension();

    // Send over the current runtime levels
    const cats = ExtensionHelper.getAllCategories();
    ExtensionHelper.sendCategoriesRuntimeUpdateMessage(cats);
  }

  public static processMessageFromExtension(msg: ExtensionMessageJSON<any>): void {
    if (!ExtensionHelper.registered) {
      return;
    }
    /* tslint:disable:no-console */
    if (msg.from === "tsl-extension") {
      const data = msg.data;
      switch (data.type) {
        case "request-change-loglevel":
          const valueRequest = data.value as ExtensionRequestChangeLogLevelJSON;
          const catsApplied = ExtensionHelper.applyLogLevel(valueRequest.categoryId, valueRequest.logLevel, valueRequest.recursive);
          if (catsApplied.length > 0) {
            // Send changes back
            ExtensionHelper.sendCategoriesRuntimeUpdateMessage(catsApplied);
          }
          break;
        default:
          console.log("Unknown command to process message from extension, command was: " + data.type);
          break;
      }
    }
    else {
      console.log("Dropping message (not from tsl-extension): " + msg.from);
    }
    /* tslint:enable:no-console */
  }

  public static sendCategoryLogMessage(msg: CategoryLogMessage): void {
    if (!ExtensionHelper.registered) {
      return;
    }

    const categoryIds = msg.getCategories().map((cat: Category) => {
      return cat.id;
    });

    const content = {
      type: "log-message",
      value: {
        categories: categoryIds,
        errorAsStack: msg.getErrorAsStack(),
        formattedMessage: MessageFormatUtils.renderDefaultMessage(msg, false),
        logLevel: LogLevel[msg.getLevel()].toString(),
        message: msg.getMessage(),
        resolvedErrorMessage: msg.isResolvedErrorMessage()
      }
    } as ExtensionMessageContentJSON<ExtensionCategoryLogMessageJSON>;

    const message = {
      data: content,
      from: "tsl-logging",
    } as ExtensionMessageJSON<ExtensionCategoryLogMessageJSON>;

    ExtensionHelper.sendMessage(message);
  }

  private static sendCategoriesRuntimeUpdateMessage(categories: Category[]): void {
    if (!ExtensionHelper.registered) {
      return;
    }
    const service = CategoryServiceImpl.getInstance();
    const catLevels: {categories: [{id: number, logLevel: string}]} = {categories: [{}]} as ExtensionCategoriesUpdateMessageJSON;
    categories.forEach((cat: Category) => {
      const catSettings = service.getCategorySettings(cat);
      if (catSettings != null) {
        catLevels.categories.push({id: cat.id, logLevel: LogLevel[catSettings.logLevel].toString()});
      }
    });

    const content = {
      type: "categories-rt-update",
      value: catLevels,
    } as ExtensionMessageContentJSON<ExtensionCategoriesUpdateMessageJSON>;

    const message = {
      data: content,
      from: "tsl-logging"
    } as ExtensionMessageJSON<ExtensionCategoriesUpdateMessageJSON>;

    ExtensionHelper.sendMessage(message);
  }

  private static sendRootCategoriesToExtension(): void {
    if (!ExtensionHelper.registered) {
      return;
    }

    const categories = CategoryServiceImpl.getInstance().getRootCategories().map((cat: Category) => {
      return ExtensionHelper.getCategoryAsJSON(cat);
    });

    const content = {
      type: "root-categories-tree",
      value: categories
    } as ExtensionMessageContentJSON<ExtensionCategoryJSON[]>;

    const message = {
      data: content,
      from: "tsl-logging"
    } as ExtensionMessageJSON<ExtensionCategoryJSON[]>;

    ExtensionHelper.sendMessage(message);
  }

  /**
   * If extension integration is enabled, will send the root categories over to the extension.
   * Otherwise does nothing.
   */
  private static getCategoryAsJSON(cat: Category): ExtensionCategoryJSON {
    const childCategories = cat.children.map((child) => {
      return ExtensionHelper.getCategoryAsJSON(child);
    });

    return {
      children: childCategories,
      id: cat.id,
      logLevel: LogLevel[cat.logLevel].toString(),
      name: cat.name,
      parentId: (cat.parent != null ? cat.parent.id : null),
    } as ExtensionCategoryJSON;
  }

  private static applyLogLevel(categoryId: number, logLevel: string, recursive: boolean): Category[] {
    const cats: Category[] = [];

    const category = CategoryServiceImpl.getInstance().getCategoryById(categoryId);
    if (category != null) {
      ExtensionHelper._applyLogLevelRecursive(category, LogLevel.fromString(logLevel), recursive, cats);
    }
    else {
      /* tslint:disable:no-console */
      console.log("Could not change log level, failed to find category with id: " + categoryId);
      /* tslint:enable:no-console */
    }

    return cats;
  }

  private static _applyLogLevelRecursive(category: Category, logLevel: LogLevel, recursive: boolean, cats: Category[]): void {
    const categorySettings = CategoryServiceImpl.getInstance().getCategorySettings(category);
    if (categorySettings != null) {
      categorySettings.logLevel = logLevel;

      cats.push(category);

      if (recursive) {
        category.children.forEach((child: Category) => {
          ExtensionHelper._applyLogLevelRecursive(child, logLevel, recursive, cats);
        });
      }
    }
  }

  private static getAllCategories(): Category[] {
    const cats: Category[] = [];

    const addCats = (cat: Category, allCats: Category[]) => {
      allCats.push(cat);

      cat.children.forEach((catChild: Category) => {
        addCats(catChild, allCats);
      });
    };

    CategoryServiceImpl.getInstance().getRootCategories().forEach((cat: Category) => {
      addCats(cat, cats);
    });

    return cats;
  }

  private static sendMessage(msg: ExtensionMessageJSON<any>): void {
    if (!ExtensionHelper.registered) {
      return;
    }

    if (typeof window !== "undefined") {
      /* tslint:disable:no-console */
      console.log("Sending message to extension, message type: " + msg.data.type);
      /* tslint:enable:no-console */
      window.postMessage(msg, "*");
    }
  }
}
