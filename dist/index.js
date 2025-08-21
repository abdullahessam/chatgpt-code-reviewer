"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commentOnPullRequestService_1 = __importDefault(require("./services/commentOnPullRequestService"));
const commentOnPrService = new commentOnPullRequestService_1.default();
commentOnPrService.addCommentToPr();
