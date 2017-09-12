/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Operative Company. All rights reserved.
 *  Licensed under the MIT license. See LICENSE.txt in the project root for license information.
 *  @author Evgeni Zharkov <zharkov.e.u@gmail.com>
 *--------------------------------------------------------------------------------------------*/

"use strict";

import * as process from "process";
import * as errors from "./errors";
import * as parser from "./parser";

type TType = "boolean" | "integer" | "float" | "string" | "array" | "object" | "exist" | "user";

interface IProperty {
  Modifier: string; // Модификатор (- | --)
  Name: string; // Название свойства
}

export interface IPropertyParsed extends IProperty {
  RawValue?: string; // Значение свойства (до преобразования в тип)
  Value?: any; // Значение свойства (после преобразования в тип)
}

export interface IPropertyDefinition extends IProperty {
  Deprecated?: boolean; // Вскоре перестанет поддерживаться
  Description?: string; // Описание свойства, используется для вывода справки
  Type: TType; // Тип свойства
  Transform?: (rawValue: string) => any; // Собственная валидация и трансформация свойства
  Required?: boolean; // Обязательно ли наличие?
}

class Property implements IPropertyParsed {
  public Modifier: string;
  public Name: string;
  public RawValue: string;
  public Value: TType;

  constructor(property: IPropertyParsed) {
    this.Modifier = property.Modifier;
    this.Name = property.Name;
    this.RawValue = property.RawValue;
  }
}

interface IArgumentsConstruct {
  name?: string; // Название приложения, используется для вывода справки
  language?: string; // Язык справки
  errorHandlers?: IErrorHandlers; // Обработчики ошибок
  properties?: IPropertyDefinition[]; // Массив свойств
  source?: string[]; // Массив, из которого брать аргументы
}

interface IErrorHandlers {
  PropertyNoExist?: (error: errors.PropertyNoExist) => any;
  PropertyRequired?: (error: errors.PropertyRequired) => any;
  PropertyDeprecated?: (error: errors.PropertyDeprecated) => any;
  PropertyValueError?: (error: errors.PropertyValueError) => any;
}

export class Arguments {
  private name: string;
  private language: string;
  private source: string[];
  private errorHandlers: IErrorHandlers;
  private properties: { [name: string]: IPropertyParsed };
  private propertiesDef: { [name: string]: IPropertyDefinition };
  private propertiesRequired: string[];

  constructor(construct?: IArgumentsConstruct) {
    this.name = construct.name || ""; // TODO: Получать название из package.json;
    this.language = construct.language || "en"; // TODO: Интернационализация, список доступных языков
    this.source = construct.source || process.argv.slice(2);
    this.properties = {};
    this.propertiesDef = {};
    this.propertiesRequired = [];
    if (Array.isArray(construct.properties) && construct.properties.length) {
      construct.properties.forEach((property) => {
        this.addProperty(property);
      });
    }
    if (construct.errorHandlers) { this.addErrorHandlers(construct.errorHandlers); }
  }

  public addProperty(property: IPropertyDefinition): void {
    if (!this.propertiesDef[property.Name]) {
      if (property.Required) {
        this.propertiesRequired.push(property.Name);
      }
      if (typeof property.Transform !== "function") {
        property.Transform = parser[property.Type];
      }
      this.propertiesDef[property.Name] = property;
    }
  }

  public addErrorHandlers(handlers: IErrorHandlers): void {
    const exitAble = (error: Error) => { console.error(error.message); process.exit(2); };
    const consoleAble = (error: Error) => { console.error(error.message); };
    this.errorHandlers.PropertyNoExist = typeof handlers.PropertyNoExist === "function" ?
      handlers.PropertyNoExist : exitAble;
    this.errorHandlers.PropertyRequired = typeof handlers.PropertyRequired === "function" ?
      handlers.PropertyRequired : exitAble;
    this.errorHandlers.PropertyDeprecated = typeof handlers.PropertyDeprecated === "function" ?
      handlers.PropertyDeprecated : consoleAble;
    this.errorHandlers.PropertyValueError = typeof handlers.PropertyValueError === "function" ?
      handlers.PropertyValueError : exitAble;
  }

  // TODO: Добавить функции перехвата ошибок
  public parseProperties(): { [name: string]: IPropertyParsed } {
    let propertyNameTemp: string = "";
    let propertyRequiredExist: number = this.propertiesRequired.length;
    this.source.forEach((part: string, index: number) => {
      if (propertyNameTemp) {
        this.properties[propertyNameTemp].RawValue = part;
        try {
          this.properties[propertyNameTemp].Value = this.propertiesDef[propertyNameTemp].Transform(part);
        } catch (error) {
          this.errorHandlers.PropertyValueError(
            error.propertyValueError(this.propertiesDef[propertyNameTemp]));
        }
      } else if (part[0] === "-") {
        propertyNameTemp = part[1] === "-" ? part.substring(2) : part.substring(1);
        const property: IPropertyParsed = {
          Modifier: part[1] === "-" ? "--" : "-",
          Name: propertyNameTemp,
        };
        try {
          if (!this.propertiesDef[property.Name]) { errors.propertyNoExist(property); }
          if (this.propertiesDef[property.Name].Deprecated) { errors.propertyDeprecated(property); }
          this.properties[property.Name] = property;
          if (this.propertiesDef[property.Name].Type === "exist") {
            this.properties[property.Name].RawValue = "true";
            this.properties[property.Name].Value = true;
            propertyNameTemp = "";
          }
        } catch (error) {
          if (error instanceof errors.PropertyNoExist) {
            this.errorHandlers.PropertyNoExist(error);
          } else if (error instanceof errors.PropertyDeprecated) {
            this.errorHandlers.PropertyDeprecated(error);
          } else {
            throw error;
          }
        }
      }
    });
    try {
      for (const property of Object.keys(this.properties)) {
        const requiredIndex = this.propertiesRequired.indexOf(this.properties[property].Name);
        if (requiredIndex !== -1) {
          this.propertiesRequired.splice(requiredIndex, 1);
          propertyRequiredExist--;
        }
      }
      if (propertyRequiredExist !== 0) { errors.propertyRequired(this.propertiesDef[this.propertiesRequired[0]]); }
    } catch (error) {
      if (error instanceof errors.PropertyRequired) {
        this.errorHandlers.PropertyRequired(error);
      } else {
        throw new Error();
      }
    }
    return this.properties;
  }
}
